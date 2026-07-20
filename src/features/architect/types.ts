export const ARCHITECT_GRAPH_VERSION = "architect.graph.v1" as const;
export const ARCHITECT_LEXICON_VERSION = "architect.lexicon.v1" as const;
export const ARCHITECT_NODE_LIMIT = 15;

export type NodeKind =
  | "input"
  | "output"
  | "action"
  | "router"
  | "evaluator"
  | "human_review"
  | "schema_gate"
  | "context_gate";

export type PolicyNodeKind = "schema_gate" | "context_gate" | "human_review";

export type ActionKind =
  | "reasoning"
  | "web_search"
  | "file_operation"
  | "knowledge_retrieval"
  | "code_execution"
  | "api_call"
  | "notification";

export type RouterOperand =
  | "fixture.numericValue"
  | "fixture.booleanFlag"
  | "unsupported";

export type RouterOperator =
  | ">"
  | ">="
  | "<"
  | "<="
  | "=="
  | "!="
  | "truthy"
  | "falsy"
  | "default";

export interface RouterRoute {
  id: string;
  label: string;
  role: "condition" | "default";
}

export interface InputConfig {
  type: "input";
}

export interface OutputConfig {
  type: "output";
}

export interface ActionConfig {
  type: "action";
  actionKind: ActionKind;
  operationVerb: string;
  simulated: true;
}

export interface EvaluatorConfig {
  type: "evaluator";
  criterion: string;
}

export interface HumanReviewConfig {
  type: "human_review";
  instruction: string;
}

export interface SchemaGateConfig {
  type: "schema_gate";
  contractName: string;
  mode: "strict" | "strip_unknown";
  requiredFields: string[];
  violationBehavior: "stop" | "review";
}

export interface ContextGateConfig {
  type: "context_gate";
  tokenCap: number;
  strategy: "select" | "summarize" | "truncate";
  allowedSources: string[];
  blockedFields: string[];
}

export interface RouterConfig {
  type: "router";
  displayCondition: string;
  operand: RouterOperand;
  operator: RouterOperator;
  comparisonValue?: number | boolean | string;
  routes: [RouterRoute, RouterRoute];
  conditionRouteId: string;
  defaultRouteId: string;
}

export type ArchitectNodeConfig =
  | InputConfig
  | OutputConfig
  | ActionConfig
  | RouterConfig
  | EvaluatorConfig
  | HumanReviewConfig
  | SchemaGateConfig
  | ContextGateConfig;

export interface ArchitectNode {
  id: string;
  kind: NodeKind;
  label: string;
  config: ArchitectNodeConfig;
  position: { x: number; y: number };
}

export interface ArchitectEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ExtractionNote {
  id: string;
  kind: "unmatched" | "ambiguous" | "placeholder" | "node_cap" | "fallback";
  message: string;
  sourceStart?: number;
  sourceEnd?: number;
}

export interface ArchitectGraph {
  schemaVersion: typeof ARCHITECT_GRAPH_VERSION;
  lexiconVersion: typeof ARCHITECT_LEXICON_VERSION;
  descriptionSnapshot: string;
  nodes: ArchitectNode[];
  edges: ArchitectEdge[];
  extractionNotes: ExtractionNote[];
  origin: "local" | "local_fallback";
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface StructuralEvidence {
  nodeCount: number;
  edgeCount: number;
  criticalPathLength: number;
  maximumExplicitParallelWidth: number;
  guardedBranchCount: number;
}

export interface ConstraintMapEvidence {
  schemaGateCount: number;
  contextBoundaryCount: number;
  humanReviewCount: number;
  routerCount: number;
  unresolvedDecisionSlotCount: number;
}
