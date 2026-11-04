"""PowerDesigner PDM parser adapted from the ideas in bianjp/pdmreader.

The original project focuses on tables and DDL.  This parser keeps names and
metadata intact, adds relationships and other model objects, and emits a JSON
shape designed for an interactive diagram.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from io import BytesIO
import re
from typing import Any, Iterable

from lxml import etree


MAX_MODEL_BYTES = 150 * 1024 * 1024
# Kept as a compatibility alias for callers that imported the old constant.
MAX_PDM_BYTES = MAX_MODEL_BYTES
CONTROL_CHARACTERS = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class PDMParseError(ValueError):
    """Raised when a file is not a readable PowerDesigner model."""


def local_name(node: etree._Element) -> str:
    return etree.QName(node).localname


def child(node: etree._Element, name: str) -> etree._Element | None:
    for item in node:
        if isinstance(item.tag, str) and local_name(item) == name:
            return item
    return None


def children(node: etree._Element, collection: str, item: str) -> list[etree._Element]:
    container = child(node, collection)
    if container is None:
        return []
    return [entry for entry in container if isinstance(entry.tag, str) and local_name(entry) == item]


def text(node: etree._Element, name: str, default: str = "") -> str:
    item = child(node, name)
    if item is None or item.text is None:
        return default
    return item.text.strip()


def ref_from(node: etree._Element, collection: str, item: str) -> str | None:
    entries = children(node, collection, item)
    return entries[0].get("Ref") if entries else None


def all_objects(root: etree._Element, kind: str) -> Iterable[etree._Element]:
    seen: set[str] = set()
    for node in root.xpath(f"//*[local-name()='{kind}' and @Id]"):
        node_id = node.get("Id")
        if node_id and node_id not in seen:
            seen.add(node_id)
            yield node


def common_metadata(node: etree._Element) -> dict[str, Any]:
    return {
        "id": node.get("Id", ""),
        "name": text(node, "Name"),
        "code": text(node, "Code"),
        "comment": text(node, "Comment"),
        "description": text(node, "Description"),
        "stereotype": text(node, "Stereotype"),
        "creator": text(node, "Creator"),
        "modifier": text(node, "Modifier"),
        "creationDate": text(node, "CreationDate"),
        "modificationDate": text(node, "ModificationDate"),
    }


def parse_column(node: etree._Element, pk_refs: set[str]) -> dict[str, Any]:
    result = common_metadata(node)
    result.update(
        {
            "dataType": text(node, "DataType"),
            "length": text(node, "Length"),
            "precision": text(node, "Precision"),
            "mandatory": text(node, "Column.Mandatory") == "1",
            "defaultValue": text(node, "DefaultValue"),
            "identity": text(node, "Identity") == "1",
            "primaryKey": result["id"] in pk_refs,
            "domainRef": ref_from(node, "Domain", "PhysicalDomain")
            or ref_from(node, "Domain", "Domain"),
        }
    )
    return result


def key_column_refs(node: etree._Element) -> list[str]:
    return [entry.get("Ref", "") for entry in children(node, "Key.Columns", "Column") if entry.get("Ref")]


def parse_table(node: etree._Element) -> dict[str, Any]:
    key_nodes = children(node, "Keys", "Key")
    keys = []
    for key_node in key_nodes:
        key_data = common_metadata(key_node)
        key_data["constraintName"] = text(key_node, "ConstraintName")
        key_data["columnRefs"] = key_column_refs(key_node)
        keys.append(key_data)

    primary_key_ref = ref_from(node, "PrimaryKey", "Key")
    pk_refs = {
        column_ref
        for key in keys
        if key["id"] == primary_key_ref
        for column_ref in key["columnRefs"]
    }

    indexes = []
    for index_node in children(node, "Indexes", "Index"):
        index_data = common_metadata(index_node)
        index_data["unique"] = text(index_node, "Unique") == "1"
        index_data["columnRefs"] = [
            column.get("Ref", "")
            for wrapper in children(index_node, "IndexColumns", "IndexColumn")
            for column_group in [child(wrapper, "Column")]
            if column_group is not None
            for column in column_group
            if local_name(column) == "Column" and column.get("Ref")
        ]
        indexes.append(index_data)

    result = common_metadata(node)
    result.update(
        {
            "kind": "table",
            "columns": [parse_column(column, pk_refs) for column in children(node, "Columns", "Column")],
            "keys": keys,
            "indexes": indexes,
            "primaryKeyRef": primary_key_ref,
            "ownerRef": ref_from(node, "Owner", "User"),
        }
    )
    return result


def parse_view(node: etree._Element) -> dict[str, Any]:
    result = common_metadata(node)
    result.update(
        {
            "kind": "view",
            "query": text(node, "View.SQLQuery") or text(node, "SQLQuery"),
            "columns": [parse_column(column, set()) for column in children(node, "Columns", "ViewColumn")],
        }
    )
    return result


def parse_simple(node: etree._Element, kind: str) -> dict[str, Any]:
    result = common_metadata(node)
    result["kind"] = kind
    if kind == "domain":
        result.update(
            {
                "dataType": text(node, "DataType"),
                "length": text(node, "Length"),
                "mandatory": text(node, "Mandatory") == "1",
                "defaultValue": text(node, "DefaultValue"),
            }
        )
    return result


def parse_reference(node: etree._Element) -> dict[str, Any]:
    result = common_metadata(node)
    joins = []
    for join in children(node, "Joins", "ReferenceJoin"):
        joins.append(
            {
                "parentColumnRef": ref_from(join, "Object1", "Column"),
                "childColumnRef": ref_from(join, "Object2", "Column"),
            }
        )
    result.update(
        {
            "kind": "reference",
            "parentTableRef": ref_from(node, "ParentTable", "Table"),
            "childTableRef": ref_from(node, "ChildTable", "Table"),
            "cardinality": text(node, "Cardinality"),
            "updateConstraint": text(node, "UpdateConstraint"),
            "deleteConstraint": text(node, "DeleteConstraint"),
            "joins": joins,
        }
    )
    return result


def parse_cdm_data_item(node: etree._Element) -> dict[str, Any]:
    result = common_metadata(node)
    result.update(
        {
            "kind": "dataItem",
            "dataType": text(node, "DataType"),
            "length": text(node, "Length"),
            "precision": text(node, "Precision"),
        }
    )
    return result


def cdm_data_item_ref(node: etree._Element) -> str | None:
    return ref_from(node, "DataItem", "DataItem")


def parse_cdm_entity(node: etree._Element, data_items: dict[str, dict[str, Any]]) -> dict[str, Any]:
    primary_identifier_ref = ref_from(node, "PrimaryIdentifier", "Identifier")
    identifiers = {
        identifier.get("Id", ""): identifier
        for identifier in all_objects(node, "Identifier")
        if identifier.get("Id")
    }
    primary_attribute_refs = {
        attribute.get("Ref", "")
        for identifier_attribute in children(identifiers.get(primary_identifier_ref), "Identifier.Attributes", "EntityAttribute")
        for attribute in [identifier_attribute]
        if attribute.get("Ref")
    } if primary_identifier_ref and identifiers.get(primary_identifier_ref) is not None else set()

    attributes = []
    for attribute_node in children(node, "Attributes", "EntityAttribute"):
        attribute = common_metadata(attribute_node)
        data_ref = cdm_data_item_ref(attribute_node)
        data_item = data_items.get(data_ref or "", {})
        attribute.update(
            {
                "kind": "attribute",
                "name": data_item.get("name", attribute["name"]),
                "code": data_item.get("code", attribute["code"]),
                "dataType": data_item.get("dataType", ""),
                "length": data_item.get("length", ""),
                "precision": data_item.get("precision", ""),
                "mandatory": text(attribute_node, "BaseAttribute.Mandatory") == "1",
                "primaryKey": attribute_node.get("Id", "") in primary_attribute_refs,
                "dataItemRef": data_ref,
            }
        )
        attributes.append(attribute)

    result = common_metadata(node)
    result.update(
        {
            "kind": "entity",
            "columns": attributes,
            "attributes": attributes,
            "primaryIdentifierRef": primary_identifier_ref,
            "identifiers": [common_metadata(identifier) for identifier in identifiers.values()],
        }
    )
    return result


def parse_cdm_relationship(node: etree._Element) -> dict[str, Any]:
    result = common_metadata(node)
    entity1_ref = ref_from(node, "Object1", "Entity")
    entity2_ref = ref_from(node, "Object2", "Entity")
    entity1_cardinality = text(node, "Entity1ToEntity2RoleCardinality")
    entity2_cardinality = text(node, "Entity2ToEntity1RoleCardinality")
    result.update(
        {
            "kind": "relationship",
            "entity1Ref": entity1_ref,
            "entity2Ref": entity2_ref,
            # These aliases let the existing diagram edge renderer work for
            # both physical references and conceptual relationships.
            "parentTableRef": entity1_ref,
            "childTableRef": entity2_ref,
            "entity1Cardinality": entity1_cardinality,
            "entity2Cardinality": entity2_cardinality,
            "cardinality": f"{entity1_cardinality} / {entity2_cardinality}".strip(" /"),
            "entity1Role": text(node, "Entity1ToEntity2Role"),
            "entity2Role": text(node, "Entity2ToEntity1Role"),
        }
    )
    return result


def parse_cdm_rule(node: etree._Element) -> dict[str, Any]:
    result = common_metadata(node)
    result.update(
        {
            "kind": "businessRule",
            "ruleType": text(node, "Type"),
            "serverExpression": text(node, "ServerExpression"),
        }
    )
    return result


@dataclass(slots=True)
class PDMParser:
    raw: bytes
    filename: str = "modelo.pdm"

    def parse(self) -> dict[str, Any]:
        if not self.raw:
            raise PDMParseError("O arquivo está vazio.")
        if len(self.raw) > MAX_MODEL_BYTES:
            raise PDMParseError("O arquivo excede o limite de 150 MB.")

        removed_control_characters = len(CONTROL_CHARACTERS.findall(self.raw))
        cleaned = CONTROL_CHARACTERS.sub(b"", self.raw)
        parser = etree.XMLParser(
            recover=True,
            resolve_entities=False,
            no_network=True,
            huge_tree=True,
            remove_comments=True,
        )
        try:
            root = etree.parse(BytesIO(cleaned), parser).getroot()
        except (etree.XMLSyntaxError, ValueError) as exc:
            raise PDMParseError(f"XML inválido: {exc}") from exc

        if root is None or local_name(root) not in {"PowerDesigner", "Model", "RootObject"}:
            raise PDMParseError("O arquivo não parece ser um modelo PDM/CDM do PowerDesigner.")

        model_nodes = list(all_objects(root, "Model"))
        model_node = model_nodes[0] if model_nodes else root
        if self._is_cdm(cleaned, root):
            return self._parse_cdm(root, model_node, parser, removed_control_characters)

        tables = [parse_table(node) for node in all_objects(root, "Table")]
        views = [parse_view(node) for node in all_objects(root, "View")]
        references = [parse_reference(node) for node in all_objects(root, "Reference")]
        domains = [parse_simple(node, "domain") for node in all_objects(root, "PhysicalDomain")]
        sequences = [parse_simple(node, "sequence") for node in all_objects(root, "Sequence")]
        procedures = [parse_simple(node, "procedure") for node in all_objects(root, "Procedure")]

        table_ids = {table["id"] for table in tables}
        references = [
            reference
            for reference in references
            if reference["parentTableRef"] in table_ids and reference["childTableRef"] in table_ids
        ]
        model = common_metadata(model_node)
        model.update({"filename": self.filename, "targetDatabase": self._target_database(root), "modelType": "PDM", "notation": "Físico"})

        object_groups = {
            "tables": tables,
            "views": views,
            "references": references,
            "domains": domains,
            "sequences": sequences,
            "procedures": procedures,
        }
        counts = {name: len(items) for name, items in object_groups.items()}
        counts["columns"] = sum(len(table["columns"]) for table in tables)
        counts["relationshipJoins"] = sum(len(reference["joins"]) for reference in references)
        counts["recoveredXmlErrors"] = len(parser.error_log) + removed_control_characters

        duplicate_codes = [
            code for code, quantity in Counter(table["code"] for table in tables if table["code"]).items() if quantity > 1
        ]
        return {
            "model": model,
            "counts": counts,
            "warnings": {
                "xmlRecovery": [str(error) for error in list(parser.error_log)[:10]],
                "duplicateTableCodes": duplicate_codes,
            },
            **object_groups,
        }

    @staticmethod
    def _is_cdm(raw: bytes, root: etree._Element) -> bool:
        return b"CDM_DATA_MODEL_XML" in raw[:4096] or bool(all_objects(root, "Entity")) and not bool(all_objects(root, "Table"))

    def _parse_cdm(self, root: etree._Element, model_node: etree._Element, parser: etree.XMLParser, removed_control_characters: int) -> dict[str, Any]:
        data_item_nodes = list(all_objects(root, "DataItem"))
        data_items = {node.get("Id", ""): parse_cdm_data_item(node) for node in data_item_nodes if node.get("Id")}
        entities = [parse_cdm_entity(node, data_items) for node in all_objects(root, "Entity")]
        relationships = [parse_cdm_relationship(node) for node in all_objects(root, "Relationship")]
        rules = [parse_cdm_rule(node) for node in all_objects(root, "BusinessRule")]
        model = common_metadata(model_node)
        model.update(
            {
                "modelType": "CDM",
                "notation": "ER/Merise",
                "diagramType": "Conceitual",
                "filename": self.filename,
                "targetDatabase": "",
            }
        )
        counts = {
            "entities": len(entities),
            "tables": len(entities),
            "columns": sum(len(entity["columns"]) for entity in entities),
            "relationships": len(relationships),
            "references": len(relationships),
            "dataItems": len(data_items),
            "businessRules": len(rules),
            "relationshipJoins": 0,
            "recoveredXmlErrors": len(parser.error_log) + removed_control_characters,
        }
        return {
            "model": model,
            "counts": counts,
            "warnings": {"xmlRecovery": [str(error) for error in list(parser.error_log)[:10]], "duplicateTableCodes": []},
            "entities": entities,
            "tables": entities,
            "relationships": relationships,
            "references": relationships,
            "dataItems": list(data_items.values()),
            "businessRules": rules,
            "views": [],
            "domains": [],
            "sequences": [],
            "procedures": [],
        }

    @staticmethod
    def _target_database(root: etree._Element) -> str:
        paths = (
            "//*[local-name()='DBMS']/*[local-name()='Shortcut']/*[local-name()='Name']",
            "//*[local-name()='DBMS']/*[local-name()='DBMS']/*[local-name()='Name']",
            "//*[local-name()='TargetModel']/*[local-name()='Name']",
        )
        for path in paths:
            nodes = root.xpath(path)
            for node in nodes:
                if node.text and node.text.strip():
                    return node.text.strip()
        return ""
