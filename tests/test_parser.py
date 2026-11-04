from fastapi.testclient import TestClient

from app.main import app
from app.pdm_parser import PDMParseError, PDMParser


PDM = b'''<?xml version="1.0" encoding="UTF-8"?>
<Model xmlns:a="attribute" xmlns:c="collection" xmlns:o="object">
  <o:RootObject Id="root"><c:Children><o:Model Id="model-1">
    <a:Name>Modelo de teste</a:Name><a:Code>TESTE</a:Code>
    <c:TargetModels><o:TargetModel Id="target"><a:Name>DB2 LUW</a:Name></o:TargetModel></c:TargetModels>
    <c:Tables>
      <o:Table Id="t1"><a:Name>CLIENTE</a:Name><a:Code>CLIENTE</a:Code><a:Creator>f606859</a:Creator>
        <c:Columns>
          <o:Column Id="c1"><a:Name>NU_CLIENTE</a:Name><a:Code>NU_CLIENTE</a:Code><a:DataType>INTEGER</a:DataType><a:Column.Mandatory>1</a:Column.Mandatory></o:Column>
        </c:Columns>
        <c:Keys><o:Key Id="k1"><a:Name>PK_CLIENTE</a:Name><c:Key.Columns><o:Column Ref="c1"/></c:Key.Columns></o:Key></c:Keys>
        <c:PrimaryKey><o:Key Ref="k1"/></c:PrimaryKey>
      </o:Table>
      <o:Table Id="t2"><a:Name>PEDIDO</a:Name><a:Code>PEDIDO</a:Code>
        <c:Columns><o:Column Id="c2"><a:Name>NU_CLIENTE</a:Name><a:Code>NU_CLIENTE</a:Code><a:DataType>INTEGER</a:DataType></o:Column></c:Columns>
      </o:Table>
    </c:Tables>
    <c:References><o:Reference Id="r1"><a:Name>CLIENTE_PEDIDO</a:Name><a:Code>FK_PEDIDO_CLIENTE</a:Code>
      <c:ParentTable><o:Table Ref="t1"/></c:ParentTable><c:ChildTable><o:Table Ref="t2"/></c:ChildTable>
      <c:Joins><o:ReferenceJoin Id="j1"><c:Object1><o:Column Ref="c1"/></c:Object1><c:Object2><o:Column Ref="c2"/></c:Object2></o:ReferenceJoin></c:Joins>
    </o:Reference></c:References>
  </o:Model></c:Children></o:RootObject>
</Model>'''

CDM = b'''<?xml version="1.0" encoding="UTF-8"?>
<?PowerDesigner signature="CDM_DATA_MODEL_XML"?>
<Model xmlns:a="attribute" xmlns:c="collection" xmlns:o="object">
  <o:RootObject Id="root"><c:Children><o:Model Id="model-1">
    <a:Name>Faculdade conceitual</a:Name><a:Code>FACULDADE</a:Code>
    <c:Entities>
      <o:Entity Id="e1"><a:Name>Aluno</a:Name><a:Code>ALUNO</a:Code>
        <c:Identifiers><o:Identifier Id="i1"><a:Name>PK_ALUNO</a:Name><a:Code>PK_ALUNO</a:Code>
          <c:Identifier.Attributes><o:EntityAttribute Ref="a1"/></c:Identifier.Attributes>
        </o:Identifier></c:Identifiers>
        <c:PrimaryIdentifier><o:Identifier Ref="i1"/></c:PrimaryIdentifier>
        <c:Attributes><o:EntityAttribute Id="a1"><a:BaseAttribute.Mandatory>1</a:BaseAttribute.Mandatory><c:DataItem><o:DataItem Ref="d1"/></c:DataItem></o:EntityAttribute></c:Attributes>
      </o:Entity>
      <o:Entity Id="e2"><a:Name>Matricula</a:Name><a:Code>MATRICULA</a:Code>
        <c:Attributes><o:EntityAttribute Id="a2"><c:DataItem><o:DataItem Ref="d2"/></c:DataItem></o:EntityAttribute></c:Attributes>
      </o:Entity>
    </c:Entities>
    <c:Relationships><o:Relationship Id="r1"><a:Name>possui</a:Name><a:Code>POSSUI</a:Code>
      <a:Entity1ToEntity2RoleCardinality>0,n</a:Entity1ToEntity2RoleCardinality>
      <a:Entity2ToEntity1RoleCardinality>1,1</a:Entity2ToEntity1RoleCardinality>
      <c:Object1><o:Entity Ref="e1"/></c:Object1><c:Object2><o:Entity Ref="e2"/></c:Object2>
    </o:Relationship></c:Relationships>
    <c:DataItems>
      <o:DataItem Id="d1"><a:Name>ID Aluno</a:Name><a:Code>ID_ALUNO</a:Code><a:DataType>N10</a:DataType><a:Length>10</a:Length></o:DataItem>
      <o:DataItem Id="d2"><a:Name>ID Matricula</a:Name><a:Code>ID_MATRICULA</a:Code><a:DataType>N10</a:DataType><a:Length>10</a:Length></o:DataItem>
    </c:DataItems>
  </o:Model></c:Children></o:RootObject>
</Model>'''


def test_parser_extracts_tables_columns_and_reference():
    result = PDMParser(PDM, "teste.pdm").parse()

    assert result["model"]["name"] == "Modelo de teste"
    assert result["counts"]["tables"] == 2
    assert result["counts"]["columns"] == 2
    assert result["counts"]["references"] == 1
    assert result["tables"][0]["columns"][0]["primaryKey"] is True
    assert result["references"][0]["parentTableRef"] == "t1"
    assert result["references"][0]["joins"][0] == {"parentColumnRef": "c1", "childColumnRef": "c2"}


def test_parser_recovers_control_character():
    result = PDMParser(PDM.replace(b"Modelo de teste", b"Modelo\x08 de teste")).parse()
    assert result["model"]["name"] == "Modelo de teste"


def test_parser_rejects_non_powerdesigner_xml():
    try:
        PDMParser(b"<catalog><item /></catalog>").parse()
    except PDMParseError as exc:
        assert "PowerDesigner" in str(exc)
    else:
        raise AssertionError("PDMParseError was not raised")


def test_parser_extracts_cdm_entities_attributes_and_relationships():
    result = PDMParser(CDM, "faculdade.cdm").parse()

    assert result["model"]["modelType"] == "CDM"
    assert result["model"]["notation"] == "ER/Merise"
    assert result["counts"]["entities"] == 2
    assert result["counts"]["relationships"] == 1
    assert result["entities"][0]["columns"][0]["name"] == "ID Aluno"
    assert result["entities"][0]["columns"][0]["primaryKey"] is True
    assert result["relationships"][0]["entity1Ref"] == "e1"
    assert result["relationships"][0]["entity2Ref"] == "e2"


def test_http_health_and_upload():
    client = TestClient(app)
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/models/demo").json()["counts"]["tables"] == 3
    response = client.post("/api/models/parse", files={"file": ("modelo.pdm", PDM, "application/xml")})
    assert response.status_code == 200
    assert response.json()["counts"]["tables"] == 2

    cdm_response = client.post("/api/models/parse", files={"file": ("faculdade.cdm", CDM, "application/xml")})
    assert cdm_response.status_code == 200
    assert cdm_response.json()["model"]["notation"] == "ER/Merise"
