(() => {
  "use strict";

  const PDM_GROUPS = [
    ["tables", "Tabelas", "table"],
    ["views", "Views", "view"],
    ["references", "Relacionamentos", "reference"],
    ["domains", "Domínios", "domain"],
    ["sequences", "Sequências", "sequence"],
    ["procedures", "Procedimentos", "procedure"],
  ];
  const CDM_GROUPS = [
    ["entities", "Entidades", "entity"],
    ["references", "Relacionamentos", "relationship"],
    ["businessRules", "Regras de negócio", "businessRule"],
  ];
  const LABELS = {
    table: "Tabela", entity: "Entidade", view: "View", reference: "Relacionamento",
    relationship: "Relacionamento ER/Merise", businessRule: "Regra de negócio",
    domain: "Domínio", sequence: "Sequência", procedure: "Procedimento",
  };
  const CANVAS_MIN_WIDTH = 3600;
  const CANVAS_MIN_HEIGHT = 2600;
  const CANVAS_PADDING_X = 640;
  const CANVAS_PADDING_Y = 520;
  const LAYOUT_COLUMN_GAP = 340;
  const LAYOUT_ROW_GAP = 270;
  const LAYOUT_COMPONENT_GAP = 180;
  const ALPHABETICAL = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

  const state = {
    model: null,
    selected: new Set(),
    selectedColumns: new Set(),
    inspected: null,
    positions: new Map(),
    openGroups: new Set(["tables"]),
    transform: { x: 50, y: 70, scale: 1 },
    drag: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    file: $("#pdm-file"), loading: $("#loading"), tree: $("#object-tree"),
    search: $("#object-search"), clear: $("#clear-selection"),
    enableRelationships: $("#enable-relationships"), caption: $("#model-caption"),
    stats: $("#model-stats"), visible: $("#visible-count"), empty: $("#diagram-empty"),
    canvas: $("#diagram-canvas"), nodes: $("#nodes"), edges: $("#edges"),
    viewport: $("#diagram-viewport"), organize: $("#organize-diagram"), fit: $("#fit-diagram"), zoomIn: $("#zoom-in"),
    zoomOut: $("#zoom-out"), inspectorEmpty: $("#inspector-empty"),
    inspector: $("#inspector-content"), toasts: $("#toast-region"),
    demo: $("#load-demo"),
  };

  function dom(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function labelFor(item) {
    return item.code || item.name || item.id || "Sem identificação";
  }

  function isConceptualModel() {
    return state.model?.model?.modelType === "CDM";
  }

  function groupsForModel() {
    return isConceptualModel() ? CDM_GROUPS : PDM_GROUPS;
  }

  function modelStats(payload) {
    if (payload.model?.modelType === "CDM") {
      return `${payload.counts.entities} entidades · ${payload.counts.columns} atributos · ${payload.counts.relationships} relacionamentos`;
    }
    return `${payload.counts.tables} tabelas · ${payload.counts.columns} colunas · ${payload.counts.references} relacionamentos`;
  }

  function allItems() {
    if (!state.model) return [];
    return groupsForModel().flatMap(([key]) => state.model[key] || []);
  }

  function objectById(id) {
    return allItems().find((item) => item.id === id) || null;
  }

  function showToast(message, type = "info") {
    const toast = dom("div", `toast ${type}`, message);
    els.toasts.append(toast);
    setTimeout(() => toast.remove(), 5200);
  }

  async function loadFile(file) {
    if (!file) return;
    els.loading.hidden = false;
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch("/api/models/parse", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Não foi possível ler o modelo.");
      state.model = payload;
      state.selected.clear();
      state.selectedColumns.clear();
      state.inspected = null;
      state.positions.clear();
      state.openGroups = new Set([isConceptualModel() ? "entities" : "tables"]);
      state.transform = { x: 50, y: 70, scale: 1 };
      els.tree.scrollTop = 0;
      els.caption.textContent = `${payload.model.name || payload.model.code || file.name} · ${payload.model.notation || payload.model.targetDatabase || "Modelo PowerDesigner"}`;
      els.stats.textContent = modelStats(payload);
      els.search.disabled = false;
      els.clear.disabled = false;
      els.enableRelationships.disabled = true;
      renderTree();
      renderDiagram();
      renderInspector();
      const recoveryCount = payload.counts.recoveredXmlErrors || 0;
      showToast(`Modelo carregado: ${payload.model.modelType === "CDM" ? `${payload.counts.entities} entidades` : `${payload.counts.tables} tabelas`} e ${payload.counts.references} relacionamentos.`);
      if (recoveryCount) showToast(`O parser recuperou ${recoveryCount} ocorrência(s) de XML malformado.`, "error");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      els.loading.hidden = true;
      els.file.value = "";
    }
  }

  async function loadDemo() {
    els.loading.hidden = false;
    try {
      const response = await fetch("/api/models/demo");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Não foi possível abrir o exemplo.");
      state.model = payload;
      state.selected = new Set(payload.tables.map((item) => item.id));
      payload.references.forEach((item) => state.selected.add(item.id));
      state.selectedColumns.clear();
      state.inspected = null;
      state.positions.clear();
      state.openGroups = new Set([isConceptualModel() ? "entities" : "tables"]);
      state.transform = { x: 50, y: 70, scale: 1 };
      els.tree.scrollTop = 0;
      els.caption.textContent = `${payload.model.name} · ${payload.model.notation || payload.model.targetDatabase || "Modelo PowerDesigner"}`;
      els.stats.textContent = modelStats(payload);
      els.search.disabled = false;
      els.clear.disabled = false;
      els.enableRelationships.disabled = true;
      renderTree();
      renderDiagram();
      renderInspector();
      requestAnimationFrame(fitDiagram);
      showToast("Modelo demonstrativo carregado.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      els.loading.hidden = true;
    }
  }

  function renderTree() {
    const previousScrollTop = els.tree.scrollTop;
    els.tree.className = "object-tree";
    els.tree.replaceChildren();
    const query = els.search.value.trim().toLocaleLowerCase("pt-BR");
    let rendered = 0;

    for (const [key, title] of groupsForModel()) {
      const source = state.model[key] || [];
      const items = source
        .filter((item) => `${item.code} ${item.name} ${item.comment}`.toLocaleLowerCase("pt-BR").includes(query))
        .sort((left, right) => ALPHABETICAL.compare(labelFor(left), labelFor(right)) || ALPHABETICAL.compare(left.id, right.id));
      if (!items.length && query) continue;
      rendered += items.length;

      const details = dom("details", "tree-group");
      details.dataset.group = key;
      details.open = state.openGroups.has(key) || Boolean(query && items.length > 0);
      details.addEventListener("toggle", () => {
        details.open ? state.openGroups.add(key) : state.openGroups.delete(key);
      });
      const summary = dom("summary");
      const groupCheck = dom("input", "group-checkbox");
      groupCheck.type = "checkbox";
      groupCheck.checked = source.length > 0 && source.every((item) => state.selected.has(item.id));
      groupCheck.indeterminate = source.some((item) => state.selected.has(item.id)) && !groupCheck.checked;
      groupCheck.disabled = !source.length;
      groupCheck.addEventListener("click", (event) => event.stopPropagation());
      groupCheck.addEventListener("change", () => {
        for (const item of source) groupCheck.checked ? state.selected.add(item.id) : state.selected.delete(item.id);
        layoutMissingNodes();
        renderTree();
        renderDiagram();
      });
      summary.append(groupCheck, dom("span", "group-caret", "›"), dom("span", "tree-label", title), dom("span", "tree-count", String(source.length)));
      const list = dom("div", "tree-items");
      for (const item of items) {
        const row = dom("label", "tree-item");
        const checkbox = dom("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selected.has(item.id);
        checkbox.addEventListener("change", () => {
          checkbox.checked ? state.selected.add(item.id) : state.selected.delete(item.id);
          if (!checkbox.checked && state.inspected?.id === item.id) state.inspected = null;
          layoutMissingNodes();
          renderTree();
          renderDiagram();
          renderInspector();
        });
        const copy = dom("span", "item-copy");
        copy.append(dom("span", "item-code", labelFor(item)));
        if (item.name && item.name !== item.code) copy.append(dom("span", "item-name", item.name));
        row.append(checkbox, copy);
        list.append(row);
      }
      details.append(summary, list);
      els.tree.append(details);
    }
    if (!rendered && query) els.tree.append(dom("div", "no-results", "Nenhum objeto corresponde à busca."));
    els.tree.scrollTop = previousScrollTop;
    updateRelationshipAction();
  }

  function selectedNodes() {
    return allItems().filter((item) => !["reference", "relationship", "businessRule", "dataItem"].includes(item.kind) && state.selected.has(item.id));
  }

  function selectedReferences() {
    if (!state.model) return [];
    return relationshipsForSelectedNodes().filter((ref) => state.selected.has(ref.id));
  }

  function relationshipsForSelectedNodes() {
    if (!state.model) return [];
    return state.model.references.filter((ref) =>
      state.selected.has(ref.parentTableRef) && state.selected.has(ref.childTableRef));
  }

  function updateRelationshipAction() {
    const eligible = relationshipsForSelectedNodes();
    const pending = eligible.filter((reference) => !state.selected.has(reference.id));
    els.enableRelationships.disabled = pending.length === 0;
    els.enableRelationships.title = pending.length
      ? `Habilitar ${pending.length} relacionamento(s) das tabelas selecionadas`
      : eligible.length
        ? "Todos os relacionamentos das tabelas selecionadas já estão habilitados"
        : "Selecione tabelas relacionadas para habilitar seus relacionamentos";
  }

  function enableRelationshipsForSelectedNodes() {
    const pending = relationshipsForSelectedNodes().filter((reference) => !state.selected.has(reference.id));
    if (!pending.length) {
      showToast("Não há relacionamentos pendentes entre as tabelas selecionadas.");
      updateRelationshipAction();
      return;
    }
    pending.forEach((reference) => state.selected.add(reference.id));
    state.openGroups.add("references");
    renderTree();
    renderDiagram();
    renderInspector();
    showToast(`${pending.length} relacionamento(s) habilitado(s).`);
  }

  function layoutMissingNodes() {
    const nodes = selectedNodes();
    const count = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.5)));
    nodes.forEach((item, index) => {
      if (!state.positions.has(item.id)) {
        state.positions.set(item.id, { x: 80 + (index % count) * 310, y: 80 + Math.floor(index / count) * 280 });
      }
    });
  }

  function stronglyConnectedComponents(nodeIds, references) {
    const outgoing = new Map(nodeIds.map((id) => [id, []]));
    references.forEach((reference) => {
      if (reference.parentTableRef !== reference.childTableRef) {
        // N (filha) vem antes de 1 (pai) na direção preferencial do layout.
        outgoing.get(reference.childTableRef)?.push(reference.parentTableRef);
      }
    });
    const indexes = new Map();
    const lowLinks = new Map();
    const stack = [];
    const inStack = new Set();
    const components = [];
    let index = 0;

    function visit(id) {
      indexes.set(id, index);
      lowLinks.set(id, index);
      index += 1;
      stack.push(id);
      inStack.add(id);
      for (const neighbor of outgoing.get(id)) {
        if (!indexes.has(neighbor)) {
          visit(neighbor);
          lowLinks.set(id, Math.min(lowLinks.get(id), lowLinks.get(neighbor)));
        } else if (inStack.has(neighbor)) {
          lowLinks.set(id, Math.min(lowLinks.get(id), indexes.get(neighbor)));
        }
      }
      if (lowLinks.get(id) !== indexes.get(id)) return;
      const component = [];
      let current;
      do {
        current = stack.pop();
        inStack.delete(current);
        component.push(current);
      } while (current !== id);
      components.push(component);
    }

    nodeIds.forEach((id) => { if (!indexes.has(id)) visit(id); });
    return components;
  }

  function organizeSelectedNodes() {
    const nodes = selectedNodes();
    if (nodes.length < 2) {
      showToast("Selecione pelo menos duas tabelas para organizar.");
      return;
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const references = relationshipsForSelectedNodes().filter((reference) =>
      nodeById.has(reference.parentTableRef) && nodeById.has(reference.childTableRef));
    const undirected = new Map(nodes.map((node) => [node.id, new Set()]));
    references.forEach((reference) => {
      if (reference.parentTableRef === reference.childTableRef) return;
      undirected.get(reference.parentTableRef).add(reference.childTableRef);
      undirected.get(reference.childTableRef).add(reference.parentTableRef);
    });

    const graphComponents = [];
    const pending = new Set(nodes.map((node) => node.id));
    while (pending.size) {
      const first = pending.values().next().value;
      const queue = [first];
      const component = [];
      pending.delete(first);
      while (queue.length) {
        const id = queue.shift();
        component.push(id);
        for (const neighbor of undirected.get(id)) {
          if (!pending.has(neighbor)) continue;
          pending.delete(neighbor);
          queue.push(neighbor);
        }
      }
      graphComponents.push(component);
    }
    graphComponents.sort((a, b) => b.length - a.length || ALPHABETICAL.compare(labelFor(nodeById.get(a[0])), labelFor(nodeById.get(b[0]))));

    let componentTop = 80;
    for (const componentIds of graphComponents) {
      const componentSet = new Set(componentIds);
      const componentReferences = references.filter((reference) =>
        componentSet.has(reference.parentTableRef) && componentSet.has(reference.childTableRef));
      const strongComponents = stronglyConnectedComponents(componentIds, componentReferences);
      const strongIndex = new Map();
      strongComponents.forEach((component, componentIndex) => component.forEach((id) => strongIndex.set(id, componentIndex)));

      const outgoing = strongComponents.map(() => new Set());
      const indegree = strongComponents.map(() => 0);
      componentReferences.forEach((reference) => {
        const from = strongIndex.get(reference.childTableRef);
        const to = strongIndex.get(reference.parentTableRef);
        if (from === to || outgoing[from].has(to)) return;
        outgoing[from].add(to);
        indegree[to] += 1;
      });

      const ranks = strongComponents.map(() => 0);
      const queue = indegree.map((degree, index) => degree === 0 ? index : -1).filter((index) => index >= 0);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const from = queue[cursor];
        for (const to of outgoing[from]) {
          ranks[to] = Math.max(ranks[to], ranks[from] + 1);
          indegree[to] -= 1;
          if (indegree[to] === 0) queue.push(to);
        }
      }

      const roleScore = new Map(componentIds.map((id) => [id, 0]));
      componentReferences.forEach((reference) => {
        roleScore.set(reference.childTableRef, roleScore.get(reference.childTableRef) + 1);
        roleScore.set(reference.parentTableRef, roleScore.get(reference.parentTableRef) - 1);
      });
      const layers = [];
      componentIds.forEach((id) => {
        const rank = ranks[strongIndex.get(id)];
        if (!layers[rank]) layers[rank] = [];
        layers[rank].push(id);
      });
      layers.forEach((layer) => layer.sort((a, b) =>
        roleScore.get(b) - roleScore.get(a) || ALPHABETICAL.compare(labelFor(nodeById.get(a)), labelFor(nodeById.get(b)))));

      const neighbors = new Map(componentIds.map((id) => [id, []]));
      componentReferences.forEach((reference) => {
        const weight = state.selected.has(reference.id) ? 4 : 1;
        neighbors.get(reference.parentTableRef).push({ id: reference.childTableRef, weight });
        neighbors.get(reference.childTableRef).push({ id: reference.parentTableRef, weight });
      });
      for (let pass = 0; pass < 8; pass += 1) {
        const ascending = pass % 2 === 0;
        const rankOrder = layers.map((_, index) => index);
        if (!ascending) rankOrder.reverse();
        const positions = new Map();
        layers.forEach((layer) => layer.forEach((id, index) => positions.set(id, index)));
        rankOrder.forEach((rank) => {
          const previousOrder = new Map(layers[rank].map((id, index) => [id, index]));
          layers[rank].sort((a, b) => {
            const barycenter = (id) => {
              const useful = neighbors.get(id).filter((neighbor) => {
                const neighborRank = ranks[strongIndex.get(neighbor.id)];
                return ascending ? neighborRank < rank : neighborRank > rank;
              });
              if (!useful.length) return previousOrder.get(id);
              const totalWeight = useful.reduce((total, neighbor) => total + neighbor.weight, 0);
              return useful.reduce((total, neighbor) => total + positions.get(neighbor.id) * neighbor.weight, 0) / totalWeight;
            };
            return barycenter(a) - barycenter(b) || previousOrder.get(a) - previousOrder.get(b);
          });
          layers[rank].forEach((id, index) => positions.set(id, index));
        });
      }

      const maxRows = Math.max(...layers.map((layer) => layer.length));
      layers.forEach((layer, rank) => {
        const centeredOffset = (maxRows - layer.length) * LAYOUT_ROW_GAP / 2;
        layer.forEach((id, row) => {
          state.positions.set(id, {
            x: 80 + rank * LAYOUT_COLUMN_GAP,
            y: componentTop + centeredOffset + row * LAYOUT_ROW_GAP,
          });
        });
      });
      componentTop += Math.max(LAYOUT_ROW_GAP, maxRows * LAYOUT_ROW_GAP) + LAYOUT_COMPONENT_GAP;
    }

    renderDiagram();
    requestAnimationFrame(fitDiagram);
    const visibleReferences = selectedReferences().filter((reference) => reference.parentTableRef !== reference.childTableRef).length;
    showToast(`Diagrama organizado: ${nodes.length} tabela(s) e ${visibleReferences} relacionamento(s) visível(is).`);
  }

  function renderDiagram() {
    const nodes = selectedNodes();
    layoutMissingNodes();
    els.visible.textContent = String(nodes.length);
    const hasNodes = nodes.length > 0;
    els.empty.hidden = hasNodes;
    els.canvas.hidden = !hasNodes;
    els.fit.disabled = els.zoomIn.disabled = els.zoomOut.disabled = !hasNodes;
    els.organize.disabled = nodes.length < 2;
    els.nodes.replaceChildren();
    if (!hasNodes) return;

    for (const item of nodes) {
      const card = dom("article", `diagram-node${state.inspected?.id === item.id ? " active" : ""}`);
      card.dataset.id = item.id;
      const pos = state.positions.get(item.id);
      card.style.left = `${pos.x}px`;
      card.style.top = `${pos.y}px`;
      const head = dom("div", "node-header");
      head.append(dom("span", "node-kind", LABELS[item.kind] || item.kind), dom("span", "node-code", labelFor(item)));
      if (item.name && item.name !== item.code) head.append(dom("span", "node-name", item.name));
      card.append(head);
      if (item.columns?.length) {
        const columns = dom("div", "node-columns");
        item.columns.slice(0, 7).forEach((column) => {
          const row = dom("div", "node-column");
          row.append(dom("span", "pk", column.primaryKey ? "◆" : ""), dom("code", "", labelFor(column)), dom("em", "", column.dataType || "—"));
          columns.append(row);
        });
        card.append(columns);
        if (item.columns.length > 7) card.append(dom("div", "node-more", `+ ${item.columns.length - 7} colunas`));
      } else {
        card.append(dom("div", "node-simple", item.comment || item.description || "Objeto sem descrição."));
      }
      card.addEventListener("click", () => {
        state.inspected = item;
        state.selectedColumns.clear();
        renderDiagram();
        renderInspector();
      });
      card.addEventListener("pointerdown", startNodeDrag);
      els.nodes.append(card);
    }
    requestAnimationFrame(() => {
      sizeCanvas();
      drawEdges();
      applyTransform();
    });
  }

  function sizeCanvas() {
    const nodes = selectedNodes();
    const right = Math.max(CANVAS_MIN_WIDTH, ...nodes.map((item) => state.positions.get(item.id).x + 300 + CANVAS_PADDING_X));
    const bottom = Math.max(CANVAS_MIN_HEIGHT, ...nodes.map((item) => state.positions.get(item.id).y + 260 + CANVAS_PADDING_Y));
    els.canvas.style.width = `${right}px`;
    els.canvas.style.height = `${bottom}px`;
    $("#edge-layer").setAttribute("viewBox", `0 0 ${right} ${bottom}`);
  }

  function cardGeometry(id) {
    const card = [...els.nodes.children].find((candidate) => candidate.dataset.id === id);
    if (!card) return null;
    const x = parseFloat(card.style.left);
    const y = parseFloat(card.style.top);
    return {
      card, x, y, width: card.offsetWidth, height: card.offsetHeight,
      centerX: x + card.offsetWidth / 2,
      centerY: y + card.offsetHeight / 2,
    };
  }

  function edgeRoute(parentId, childId) {
    const parent = cardGeometry(parentId);
    const child = cardGeometry(childId);
    if (!parent || !child) return null;
    if (parentId === childId) {
      const source = { x: parent.x + parent.width, y: parent.y + parent.height * .68 };
      const target = { x: parent.x + parent.width * .68, y: parent.y };
      return {
        source, target,
        path: `M ${source.x} ${source.y} C ${source.x + 90} ${source.y}, ${target.x + 90} ${target.y - 70}, ${target.x} ${target.y}`,
      };
    }
    const deltaX = child.centerX - parent.centerX;
    const deltaY = child.centerY - parent.centerY;
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      const direction = deltaY >= 0 ? 1 : -1;
      const source = { x: parent.centerX, y: parent.y + (direction > 0 ? parent.height : 0) };
      const target = { x: child.centerX, y: child.y + (direction > 0 ? 0 : child.height) };
      const bend = Math.max(60, Math.abs(target.y - source.y) * .45);
      return {
        source, target,
        path: `M ${source.x} ${source.y} C ${source.x} ${source.y + bend * direction}, ${target.x} ${target.y - bend * direction}, ${target.x} ${target.y}`,
      };
    }
    const direction = deltaX >= 0 ? 1 : -1;
    const source = { x: parent.x + (direction > 0 ? parent.width : 0), y: parent.centerY };
    const target = { x: child.x + (direction > 0 ? 0 : child.width), y: child.centerY };
    const bend = Math.max(70, Math.abs(target.x - source.x) * .45);
    return {
      source, target,
      path: `M ${source.x} ${source.y} C ${source.x + bend * direction} ${source.y}, ${target.x - bend * direction} ${target.y}, ${target.x} ${target.y}`,
    };
  }

  function drawEdges() {
    els.edges.replaceChildren();
    for (const ref of selectedReferences()) {
      const route = edgeRoute(ref.parentTableRef, ref.childTableRef);
      if (!route) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "edge");
      path.setAttribute("d", route.path);
      path.dataset.id = ref.id;
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${labelFor(ref)} (${ref.cardinality || "cardinalidade não informada"})`;
      path.append(title);
      els.edges.append(path);
      const textNode = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textNode.setAttribute("class", "edge-label");
      textNode.setAttribute("x", String((route.source.x + route.target.x) / 2));
      textNode.setAttribute("y", String((route.source.y + route.target.y) / 2 - 7));
      textNode.setAttribute("text-anchor", "middle");
      textNode.textContent = ref.code || ref.name || "REF";
      els.edges.append(textNode);
    }
  }

  function startNodeDrag(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const card = event.currentTarget;
    const position = state.positions.get(card.dataset.id);
    state.drag = { type: "node", id: card.dataset.id, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y };
    card.setPointerCapture(event.pointerId);
  }

  function startPan(event) {
    if (event.button !== 0 || event.target.closest(".diagram-node")) return;
    state.drag = { type: "pan", startX: event.clientX, startY: event.clientY, x: state.transform.x, y: state.transform.y };
    els.viewport.classList.add("panning");
    els.viewport.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.drag) return;
    if (state.drag.type === "node") {
      const position = state.positions.get(state.drag.id);
      position.x = Math.max(0, state.drag.x + (event.clientX - state.drag.startX) / state.transform.scale);
      position.y = Math.max(0, state.drag.y + (event.clientY - state.drag.startY) / state.transform.scale);
      const card = [...els.nodes.children].find((candidate) => candidate.dataset.id === state.drag.id);
      card.style.left = `${position.x}px`;
      card.style.top = `${position.y}px`;
      sizeCanvas();
      drawEdges();
    } else {
      state.transform.x = state.drag.x + event.clientX - state.drag.startX;
      state.transform.y = state.drag.y + event.clientY - state.drag.startY;
      applyTransform();
    }
  }

  function endPointer() {
    state.drag = null;
    els.viewport.classList.remove("panning");
  }

  function applyTransform() {
    const { x, y, scale } = state.transform;
    els.canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function zoom(delta, originX, originY) {
    const previous = state.transform.scale;
    const next = Math.min(2.4, Math.max(.25, previous * delta));
    const bounds = els.viewport.getBoundingClientRect();
    const px = originX ?? bounds.width / 2;
    const py = originY ?? bounds.height / 2;
    state.transform.x = px - (px - state.transform.x) * (next / previous);
    state.transform.y = py - (py - state.transform.y) * (next / previous);
    state.transform.scale = next;
    applyTransform();
  }

  function fitDiagram() {
    if (!selectedNodes().length) return;
    const cards = [...els.nodes.children];
    const minX = Math.min(...cards.map((card) => parseFloat(card.style.left)));
    const minY = Math.min(...cards.map((card) => parseFloat(card.style.top)));
    const maxX = Math.max(...cards.map((card) => parseFloat(card.style.left) + card.offsetWidth));
    const maxY = Math.max(...cards.map((card) => parseFloat(card.style.top) + card.offsetHeight));
    const view = els.viewport.getBoundingClientRect();
    const scale = Math.min(1.15, Math.max(.25, Math.min((view.width - 160) / (maxX - minX + CANVAS_PADDING_X), (view.height - 180) / (maxY - minY + CANVAS_PADDING_Y))));
    state.transform = {
      scale,
      x: (view.width - (maxX - minX + CANVAS_PADDING_X) * scale) / 2 - minX * scale + CANVAS_PADDING_X * scale / 2,
      y: (view.height - (maxY - minY + CANVAS_PADDING_Y) * scale) / 2 - minY * scale + CANVAS_PADDING_Y * scale / 2,
    };
    applyTransform();
  }

  function metadataItem(term, value, wide = false) {
    const wrapper = dom("div", `metadata-item${wide ? " wide" : ""}`);
    wrapper.append(dom("dt", "", term), dom("dd", "", value || "—"));
    return wrapper;
  }

  function renderInspector() {
    const item = state.inspected;
    els.inspectorEmpty.hidden = Boolean(item);
    els.inspector.hidden = !item;
    els.inspector.replaceChildren();
    if (!item) return;

    const head = dom("div", "inspector-head");
    head.append(dom("span", "inspector-kind", LABELS[item.kind] || item.kind), dom("h2", "", labelFor(item)), dom("p", "", item.name && item.name !== item.code ? item.name : item.comment || "Sem nome lógico adicional"));
    els.inspector.append(head);

    const general = dom("section", "metadata-section");
    general.append(dom("h3", "", "Metadados gerais"));
    const grid = dom("dl", "metadata-grid");
    grid.append(
      metadataItem("ID", item.id), metadataItem("Estereótipo", item.stereotype),
      metadataItem("Criador", item.creator), metadataItem("Modificador", item.modifier),
      metadataItem("Criação", item.creationDate), metadataItem("Alteração", item.modificationDate),
      metadataItem("Comentário", item.comment, true), metadataItem("Descrição", item.description, true),
    );
    if (item.dataType) grid.append(metadataItem("Tipo de dado", item.dataType), metadataItem("Tamanho", item.length));
    general.append(grid);
    els.inspector.append(general);

    if (item.kind === "table" || item.kind === "entity") renderTableDetails(item);
    if (item.kind === "reference" || item.kind === "relationship") renderReferenceDetails(item);
  }

  function renderTableDetails(table) {
    const section = dom("section", "metadata-section");
    section.append(dom("h3", "", `${table.kind === "entity" ? "Atributos" : "Colunas"} · ${table.columns.length}`));
    const list = dom("div", "column-list");
    table.columns.forEach((column) => {
      const label = dom("label", "column-toggle");
      const checkbox = dom("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedColumns.has(column.id);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? state.selectedColumns.add(column.id) : state.selectedColumns.delete(column.id);
        renderInspector();
      });
      const copy = dom("span");
      copy.append(dom("code", "", `${column.primaryKey ? "◆ " : ""}${labelFor(column)}`), dom("span", "", column.dataType || "Tipo não informado"));
      label.append(checkbox, copy);
      list.append(label);
    });
    section.append(list);

    const details = dom("div", "column-details");
    table.columns.filter((column) => state.selectedColumns.has(column.id)).forEach((column) => {
      const card = dom("article", "column-card");
      card.append(dom("h4", "", labelFor(column)));
      const grid = dom("dl", "metadata-grid");
      grid.append(
        metadataItem("Tipo", column.dataType), metadataItem("Obrigatória", column.mandatory ? "Sim" : "Não"),
        metadataItem("Tamanho", column.length), metadataItem("Precisão", column.precision),
        metadataItem("Chave primária", column.primaryKey ? "Sim" : "Não"), metadataItem("Identidade", column.identity ? "Sim" : "Não"),
        metadataItem("Valor padrão", column.defaultValue, true), metadataItem("Comentário", column.comment, true),
        metadataItem("Descrição", column.description, true), metadataItem("Criador", column.creator),
        metadataItem("Modificador", column.modifier),
      );
      card.append(grid);
      details.append(card);
    });
    section.append(details);
    els.inspector.append(section);

    const structures = dom("section", "metadata-section");
    structures.append(dom("h3", "", table.kind === "entity" ? "Identificadores" : "Chaves e índices"));
    const structureGrid = dom("dl", "metadata-grid");
    if (table.kind === "entity") {
      structureGrid.append(metadataItem("Identificadores", String(table.identifiers?.length || 0)), metadataItem("Identificador primário", table.primaryIdentifierRef, true));
    } else {
      structureGrid.append(metadataItem("Chaves", String(table.keys.length)), metadataItem("Índices", String(table.indexes.length)), metadataItem("PK Ref", table.primaryKeyRef, true));
    }
    structures.append(structureGrid);
    els.inspector.append(structures);
  }

  function renderReferenceDetails(reference) {
    const section = dom("section", "metadata-section");
    section.append(dom("h3", "", reference.kind === "relationship" ? "Relação conceitual ER/Merise" : "Vínculo físico"));
    const grid = dom("dl", "metadata-grid");
    if (reference.kind === "relationship") {
      grid.append(
        metadataItem("Entidade 1", labelFor(objectById(reference.entity1Ref) || { id: reference.entity1Ref }), true),
        metadataItem("Entidade 2", labelFor(objectById(reference.entity2Ref) || { id: reference.entity2Ref }), true),
        metadataItem("Cardinalidade", reference.cardinality, true),
        metadataItem("Papel da entidade 1", reference.entity1Role),
        metadataItem("Papel da entidade 2", reference.entity2Role),
      );
    } else {
      grid.append(
        metadataItem("Tabela pai", labelFor(objectById(reference.parentTableRef) || { id: reference.parentTableRef }), true),
        metadataItem("Tabela filha", labelFor(objectById(reference.childTableRef) || { id: reference.childTableRef }), true),
        metadataItem("Cardinalidade", reference.cardinality), metadataItem("Junções", String(reference.joins.length)),
        metadataItem("Atualização", reference.updateConstraint), metadataItem("Exclusão", reference.deleteConstraint),
      );
    }
    section.append(grid);
    els.inspector.append(section);
  }

  els.file.addEventListener("change", () => loadFile(els.file.files[0]));
  els.demo.addEventListener("click", loadDemo);
  els.search.addEventListener("input", renderTree);
  els.enableRelationships.addEventListener("click", enableRelationshipsForSelectedNodes);
  els.clear.addEventListener("click", () => {
    state.selected.clear(); state.inspected = null; state.selectedColumns.clear();
    renderTree(); renderDiagram(); renderInspector();
  });
  els.organize.addEventListener("click", organizeSelectedNodes);
  els.fit.addEventListener("click", fitDiagram);
  els.zoomIn.addEventListener("click", () => zoom(1.2));
  els.zoomOut.addEventListener("click", () => zoom(1 / 1.2));
  els.viewport.addEventListener("pointerdown", startPan);
  els.viewport.addEventListener("pointermove", onPointerMove);
  els.viewport.addEventListener("pointerup", endPointer);
  els.viewport.addEventListener("pointercancel", endPointer);
  els.viewport.addEventListener("wheel", (event) => {
    if (els.canvas.hidden) return;
    event.preventDefault();
    const bounds = els.viewport.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  window.addEventListener("resize", () => { if (!els.canvas.hidden) fitDiagram(); });
})();
