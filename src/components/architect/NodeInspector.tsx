import { useEffect, useMemo, useState } from "react";
import { ChevronDown, GitBranch, Move, Plus, Settings2, Trash2, Unplug } from "lucide-react";
import type { ArchitectAction, ArchitectState, InsertableKind } from "@/features/architect/architectReducer";
import type { ActionKind, ArchitectNode, RouterConfig, RouterRoute } from "@/features/architect/types";

const actionKinds: ActionKind[] = [
  "reasoning",
  "web_search",
  "file_operation",
  "knowledge_retrieval",
  "code_execution",
  "api_call",
  "notification",
];

function parseStringList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim().slice(0, 120)).filter(Boolean))].slice(0, 24);
}

function RouteEditor({
  router,
  route,
  dispatch,
}: {
  router: ArchitectNode & { config: RouterConfig };
  route: RouterRoute;
  dispatch: React.Dispatch<ArchitectAction>;
}) {
  const [routeId, setRouteId] = useState(route.id);
  const [label, setLabel] = useState(route.label);
  useEffect(() => setRouteId(route.id), [route.id]);
  useEffect(() => setLabel(route.label), [route.label]);
  return (
    <fieldset className="architect-route-editor">
      <legend>{route.role === "default" ? "Default route" : "Condition route"}</legend>
      <label>
        Route ID
        <input id={`route-${route.id}`} value={routeId} onChange={(event) => setRouteId(event.target.value)} maxLength={120} />
      </label>
      <button type="button" onClick={() => dispatch({ type: "RENAME_ROUTE_ID", routerId: router.id, oldId: route.id, newId: routeId })}>
        Commit route ID
      </button>
      <label>
        Display label
        <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={180} />
      </label>
      <button type="button" onClick={() => dispatch({ type: "RENAME_ROUTE_LABEL", routerId: router.id, routeId: route.id, label })}>
        Commit label
      </button>
      {route.role !== "default" && (
        <button type="button" onClick={() => dispatch({ type: "SWAP_DEFAULT_ROUTE", routerId: router.id, routeId: route.id })}>
          Make named default
        </button>
      )}
    </fieldset>
  );
}

function NodeConfigEditor({ node, dispatch }: { node: ArchitectNode; dispatch: React.Dispatch<ArchitectAction> }) {
  const config = node.config;
  const [actionKind, setActionKind] = useState<ActionKind>(config.type === "action" ? config.actionKind : "reasoning");
  const [operationVerb, setOperationVerb] = useState(config.type === "action" ? config.operationVerb : "edit");
  const [criterion, setCriterion] = useState(config.type === "evaluator" ? config.criterion : "Review the symbolic output");
  const [instruction, setInstruction] = useState(config.type === "human_review" ? config.instruction : "Review before continuing");
  const [displayCondition, setDisplayCondition] = useState(config.type === "router" ? config.displayCondition : "Unsupported edited condition");
  const [contractName, setContractName] = useState(config.type === "schema_gate" ? config.contractName : "OutputContract");
  const [schemaMode, setSchemaMode] = useState<"strict" | "strip_unknown">(config.type === "schema_gate" ? config.mode : "strict");
  const [requiredFields, setRequiredFields] = useState(config.type === "schema_gate" ? config.requiredFields.join(", ") : "result");
  const [violationBehavior, setViolationBehavior] = useState<"stop" | "review">(config.type === "schema_gate" ? config.violationBehavior : "stop");
  const [tokenCap, setTokenCap] = useState(String(config.type === "context_gate" ? config.tokenCap : 4_000));
  const [strategy, setStrategy] = useState<"select" | "summarize" | "truncate">(config.type === "context_gate" ? config.strategy : "select");
  const [allowedSources, setAllowedSources] = useState(config.type === "context_gate" ? config.allowedSources.join(", ") : "workflow input");
  const [blockedFields, setBlockedFields] = useState(config.type === "context_gate" ? config.blockedFields.join(", ") : "");

  if (config.type === "input" || config.type === "output") {
    return <p className="architect-config-note">Compiler-owned endpoint; no policy configuration is exposed.</p>;
  }
  if (config.type === "action") {
    return (
      <div className="architect-config-editor" id={`node-config-${node.id}`}>
        <label>Action kind<select value={actionKind} onChange={(event) => setActionKind(event.target.value as ActionKind)}>
          {actionKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}
        </select></label>
        <label>Operation verb<input value={operationVerb} onChange={(event) => setOperationVerb(event.target.value)} maxLength={80} /></label>
        <button type="button" onClick={() => dispatch({ type: "UPDATE_NODE_CONFIG", nodeId: node.id, config: { type: "action", actionKind, operationVerb, simulated: true } })}>
          Commit action configuration
        </button>
      </div>
    );
  }
  if (config.type === "evaluator") {
    return (
      <div className="architect-config-editor" id={`node-config-${node.id}`}>
        <label>Evaluation criterion<input value={criterion} onChange={(event) => setCriterion(event.target.value)} maxLength={240} /></label>
        <button type="button" onClick={() => dispatch({ type: "UPDATE_NODE_CONFIG", nodeId: node.id, config: { type: "evaluator", criterion } })}>Commit evaluator configuration</button>
      </div>
    );
  }
  if (config.type === "human_review") {
    return (
      <div className="architect-config-editor" id={`node-config-${node.id}`}>
        <label>Review instruction<input value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={240} /></label>
        <button type="button" onClick={() => dispatch({ type: "UPDATE_NODE_CONFIG", nodeId: node.id, config: { type: "human_review", instruction } })}>Commit review configuration</button>
      </div>
    );
  }
  if (config.type === "router") {
    return (
      <div className="architect-config-editor" id={`node-config-${node.id}`}>
        <label>Display condition<input value={displayCondition} onChange={(event) => setDisplayCondition(event.target.value)} maxLength={240} /></label>
        <button type="button" onClick={() => dispatch({ type: "UPDATE_NODE_CONFIG", nodeId: node.id, config: { ...config, displayCondition } })}>Commit router condition</button>
      </div>
    );
  }
  if (config.type === "schema_gate") {
    return (
      <div className="architect-config-editor" id={`node-config-${node.id}`}>
        <label>Contract name<input value={contractName} onChange={(event) => setContractName(event.target.value)} maxLength={120} /></label>
        <label>Unknown fields<select value={schemaMode} onChange={(event) => setSchemaMode(event.target.value as typeof schemaMode)}>
          <option value="strict">Strict — reject unknown</option><option value="strip_unknown">Strip unknown</option>
        </select></label>
        <label>Required fields<input value={requiredFields} onChange={(event) => setRequiredFields(event.target.value)} placeholder="result, citations" /></label>
        <label>On violation<select value={violationBehavior} onChange={(event) => setViolationBehavior(event.target.value as typeof violationBehavior)}>
          <option value="stop">Stop</option><option value="review">Send to review</option>
        </select></label>
        <button type="button" onClick={() => dispatch({
          type: "UPDATE_NODE_CONFIG",
          nodeId: node.id,
          config: { type: "schema_gate", contractName, mode: schemaMode, requiredFields: parseStringList(requiredFields), violationBehavior },
        })}>Commit schema contract</button>
      </div>
    );
  }
  return (
    <div className="architect-config-editor" id={`node-config-${node.id}`}>
      <label>Fixture symbolic-unit cap<input type="number" min={128} max={32_768} value={tokenCap} onChange={(event) => setTokenCap(event.target.value)} /></label>
      <label>Boundary strategy<select value={strategy} onChange={(event) => setStrategy(event.target.value as typeof strategy)}>
        <option value="select">Select</option><option value="summarize">Summarize</option><option value="truncate">Truncate</option>
      </select></label>
      <label>Allowed sources<input value={allowedSources} onChange={(event) => setAllowedSources(event.target.value)} placeholder="workflow input, knowledge base" /></label>
      <label>Blocked fields<input value={blockedFields} onChange={(event) => setBlockedFields(event.target.value)} placeholder="secrets, raw credentials" /></label>
      <p className="architect-config-note">This cap uses fixture symbolic units. No live token usage is measured.</p>
      <button type="button" onClick={() => dispatch({
        type: "UPDATE_NODE_CONFIG",
        nodeId: node.id,
        config: {
          type: "context_gate",
          tokenCap: Number(tokenCap),
          strategy,
          allowedSources: parseStringList(allowedSources),
          blockedFields: parseStringList(blockedFields),
        },
      })}>Commit context boundary</button>
    </div>
  );
}

export default function NodeInspector({ state, dispatch }: { state: ArchitectState; dispatch: React.Dispatch<ArchitectAction> }) {
  const graph = state.graph!;
  const selectedNode = graph.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  const selectedEdge = graph.edges.find((edge) => edge.id === state.selectedEdgeId) ?? graph.edges[0] ?? null;
  const [label, setLabel] = useState(selectedNode?.label ?? "");
  const [insertKind, setInsertKind] = useState<InsertableKind | "router">("action");
  const [insertLabel, setInsertLabel] = useState("New simulated step");
  const [source, setSource] = useState(graph.nodes[0]?.id ?? "");
  const [target, setTarget] = useState(graph.nodes[graph.nodes.length - 1]?.id ?? "");
  const [sourceHandle, setSourceHandle] = useState("");
  useEffect(() => setLabel(selectedNode?.label ?? ""), [selectedNode?.id, selectedNode?.label]);

  const sourceNode = graph.nodes.find((node) => node.id === source);
  const sourceRoutes = useMemo(() => sourceNode?.config.type === "router" ? sourceNode.config.routes : [], [sourceNode]);
  useEffect(() => {
    if (sourceRoutes.length && !sourceRoutes.some((route) => route.id === sourceHandle)) setSourceHandle(sourceRoutes[0].id);
    else if (!sourceRoutes.length && sourceHandle) setSourceHandle("");
  }, [source, sourceHandle, sourceRoutes]);

  const deleteEligible = selectedNode
    ? !["input", "output", "router"].includes(selectedNode.kind)
      && graph.edges.filter((edge) => edge.target === selectedNode.id).length === 1
      && graph.edges.filter((edge) => edge.source === selectedNode.id).length === 1
    : false;

  function nudge(dx: number, dy: number) {
    if (!selectedNode) return;
    dispatch({ type: "MOVE_NODE", nodeId: selectedNode.id, position: { x: selectedNode.position.x + dx, y: selectedNode.position.y + dy } });
  }

  function insertAdvanced() {
    if (!selectedEdge) return;
    if (insertKind === "router") {
      dispatch({ type: "INSERT_ROUTER_ON_EDGE", edgeId: selectedEdge.id, spec: { label: insertLabel, displayCondition: "Unsupported edited condition" } });
    } else {
      dispatch({ type: "INSERT_NODE_ON_EDGE", edgeId: selectedEdge.id, spec: { kind: insertKind, label: insertLabel } });
    }
  }

  return (
    <aside className="architect-inspector architect-panel" aria-labelledby="architect-inspector-title">
      <div className="architect-panel__heading"><div><h3 id="architect-inspector-title">Graph editor</h3><p>All changes validate before they commit.</p></div></div>
      {state.editError && <div id="architect-edit-error" tabIndex={-1} role="alert" className="architect-edit-error"><strong>Edit rejected</strong><span>{state.editError}</span></div>}

      <section className="architect-inspector__section">
        <h4>Nodes</h4>
        <div className="architect-item-list" aria-label="Workflow nodes">
          {graph.nodes.map((node) => (
            <button type="button" id={`node-${node.id}`} key={node.id} className={node.id === selectedNode?.id ? "is-selected" : ""} onClick={() => dispatch({ type: "SELECT_NODE", nodeId: node.id })}>
              <span>{node.label}</span><small>{node.kind.replace("_", " ")}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedNode && (
        <section className="architect-inspector__section">
          <h4><Settings2 size={14} aria-hidden="true" /> Selected node</h4>
          <label>Display label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={180} /></label>
          <button type="button" onClick={() => dispatch({ type: "RENAME_NODE", nodeId: selectedNode.id, label })}>Commit label</button>
          <NodeConfigEditor key={selectedNode.id} node={selectedNode} dispatch={dispatch} />
          <div className="architect-nudges" aria-label="Nudge selected node">
            <span><Move size={14} aria-hidden="true" /> Nudge</span>
            <button type="button" aria-label="Nudge node left" onClick={() => nudge(-10, 0)}>←</button>
            <button type="button" aria-label="Nudge node up" onClick={() => nudge(0, -10)}>↑</button>
            <button type="button" aria-label="Nudge node down" onClick={() => nudge(0, 10)}>↓</button>
            <button type="button" aria-label="Nudge node right" onClick={() => nudge(10, 0)}>→</button>
          </div>
          <button type="button" className="architect-danger-button" disabled={!deleteEligible} title={selectedNode.kind === "router" ? "Routers are undeletable in Pass 1" : undefined} onClick={() => dispatch({ type: "DELETE_LINEAR_NODE", nodeId: selectedNode.id })}>
            <Trash2 size={14} aria-hidden="true" />{selectedNode.kind === "router" ? "Router deletion deferred" : "Delete linear node"}
          </button>
        </section>
      )}

      <details className="architect-advanced">
        <summary><Plus size={14} aria-hidden="true" /> Advanced / Workflow blocks <ChevronDown size={14} aria-hidden="true" /></summary>
        <section className="architect-inspector__section" id="architect-insert-controls">
          <h4>Insert on edge</h4>
          <label>Edge<select value={selectedEdge?.id ?? ""} onChange={(event) => dispatch({ type: "SELECT_EDGE", edgeId: event.target.value })}>
            {graph.edges.map((edge) => <option key={edge.id} value={edge.id}>{edge.source} → {edge.target}</option>)}
          </select></label>
          <label>Kind<select value={insertKind} onChange={(event) => setInsertKind(event.target.value as InsertableKind | "router")}>
            <option value="action">Action</option><option value="router">Router</option><option value="evaluator">Evaluator</option><option value="human_review">Human review</option>
          </select></label>
          <label>Label<input value={insertLabel} onChange={(event) => setInsertLabel(event.target.value)} maxLength={180} /></label>
          <button type="button" onClick={insertAdvanced} disabled={!selectedEdge}>{insertKind === "router" ? <GitBranch size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}Insert {insertKind.replace("_", " ")}</button>
        </section>
      </details>

      <details className="architect-advanced">
        <summary><GitBranch size={14} aria-hidden="true" /> Advanced wiring <ChevronDown size={14} aria-hidden="true" /></summary>
        {selectedNode?.config.type === "router" && selectedNode.config.routes.map((route) => (
          <RouteEditor key={route.id} router={selectedNode as ArchitectNode & { config: RouterConfig }} route={route} dispatch={dispatch} />
        ))}
        <section className="architect-inspector__section">
          <h4>Raw connection</h4>
          <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}>
            {graph.nodes.filter((node) => node.kind !== "output").map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select></label>
          {sourceRoutes.length > 0 && <label>Source route<select value={sourceHandle} onChange={(event) => setSourceHandle(event.target.value)}>{sourceRoutes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}</select></label>}
          <label>Target<select value={target} onChange={(event) => setTarget(event.target.value)}>
            {graph.nodes.filter((node) => node.kind !== "input").map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select></label>
          <button type="button" onClick={() => dispatch({ type: "CONNECT", connection: { source, target, ...(sourceHandle ? { sourceHandle } : {}) } })}>Connect and validate</button>
          <button id="architect-reconnect-edge" type="button" disabled={!selectedEdge} onClick={() => selectedEdge && dispatch({ type: "RECONNECT_EDGE", edgeId: selectedEdge.id, target })}>Reconnect selected edge to target</button>
          <button type="button" disabled={!selectedEdge} onClick={() => selectedEdge && dispatch({ type: "DISCONNECT", edgeId: selectedEdge.id })}><Unplug size={14} aria-hidden="true" /> Disconnect selected edge</button>
        </section>
      </details>
    </aside>
  );
}
