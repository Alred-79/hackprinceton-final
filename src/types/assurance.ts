import type { NodeConfig, SimEdge, SimNode, SimNodeType } from "@/types/simulator";

export type AssuranceStatus =
  | "disabled"
  | "draft"
  | "compiling"
  | "compiled"
  | "stale"
  | "running"
  | "checked"
  | "passed"
  | "failed"
  | "unsupported";

export interface AssurancePortCapability {
  id: string;
  label?: string;
  direction: "input" | "output";
}

export interface AssuranceOperationCapability {
  operation_id: string;
  operation_version: string;
  node_type: SimNodeType;
  label: string;
  description?: string;
  default?: boolean;
  default_config?: Partial<NodeConfig>;
  ports?: AssurancePortCapability[];
  allowed_executor_contracts?: Array<{
    contract_id: string;
    contract_version: string;
    supported_output_modes: Array<"tool" | "native" | "prompted">;
  }>;
  operation_role?: string;
  config_constraints?: Record<string, unknown>;
  produced_payload_contracts?: Array<{ contract_id: string; contract_version: string }>;
}

export interface AssuranceContractCapability {
  contract_id: string;
  contract_version: string;
  label: string;
  description?: string;
  json_schema_digest?: string;
  json_schema?: Record<string, unknown>;
  supported_output_modes?: Array<"tool" | "native" | "prompted">;
}

export interface AssuranceCheckCapability {
  check_id: string;
  check_version?: string;
  label: string;
  description?: string;
  engine?: string;
  method?: string;
}

export interface AssuranceCapabilities {
  enabled: boolean;
  supported: boolean;
  scenario_id: string;
  adapter_version?: string;
  compiler_version?: string;
  operations: AssuranceOperationCapability[];
  output_contracts: AssuranceContractCapability[];
  handoff_contracts: AssuranceContractCapability[];
  evidence_checks: AssuranceCheckCapability[];
  eval_suites?: Array<{ suite_id: string; suite_version: string; label?: string }>;
  patches?: Array<{ patch_id: string; label: string; description?: string }>;
  help_text?: Record<string, string>;
  unsupported_reason?: string;
}

export interface SimulatorNodeWire {
  id: string;
  type: SimNodeType;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  locked: boolean;
}

export interface SimulatorEdgeWire {
  id: string;
  source: string;
  target: string;
  source_handle: string | null;
  target_handle: string | null;
  kind: "normal" | "conditional" | "failure" | "retry";
  fan_out: "all" | "exclusive" | null;
  route_probability: string | null;
  max_attempts: number | null;
}

export interface SimulatorGraphWire {
  schema_version: "simulator.graph.v1";
  nodes: SimulatorNodeWire[];
  edges: SimulatorEdgeWire[];
}

export interface AssuranceArtifact {
  artifact_id: string;
  scenario_id: string;
  source_graph_hash: string;
  candidate_hash: string;
  compiler_version?: string;
  created_at?: string;
  warnings?: AssuranceIssue[];
  node_map?: Record<string, string[]>;
  edge_map?: Record<string, string[]>;
  compiled_plan?: {
    steps: Array<{
      step_id: string;
      canvas_node_id: string;
      node_type: string;
      operation_id: string;
      operation_version: string;
      lowerer_id: string;
      lowerer_version: string;
      implementation_fingerprint: string;
    }>;
  };
}

export interface AssuranceIssue {
  code: string;
  message: string;
  canvas_node_id?: string;
  canvas_edge_id?: string;
  field_path?: string;
}

export interface AssuranceEvent {
  event_id?: string;
  sequence: number;
  event_type: string;
  timestamp?: string;
  canvas_node_id?: string;
  canvas_edge_id?: string;
  attempt_number?: number;
  payload?: Record<string, unknown>;
}

export interface AssuranceRunResult {
  run_id: string;
  artifact_id: string;
  candidate_hash: string;
  terminal_kind: "clean" | "recovered" | "contract_violation" | "evidence_failed" | "revision_exhausted" | "run_error";
  output?: unknown;
  error?: { code: string; message: string };
  events: AssuranceEvent[];
  internal_retry_counts?: Record<string, number>;
  outer_revision_counts?: {
    used: number;
    budget: number;
    by_gate: Record<string, number>;
    traversed_edge_ids: string[];
  };
  evidence?: Array<Record<string, unknown>>;
  containment_evidence?: {
    measurement_status: "measured" | "not_measured";
    injected_risk_ids: string[];
    contained_risk_ids: string[];
    decision: boolean | null;
  };
}

export interface AssuranceEvalResult {
  eval_id: string;
  artifact_id: string;
  candidate_hash: string;
  suite_id: string;
  suite_version: string;
  aggregate?: Record<string, unknown>;
  cases: Array<Record<string, unknown> & { run_id?: string }>;
}

export interface AssuranceEntrySnapshot {
  nodes: SimNode[];
  edges: SimEdge[];
  historyIndex: number;
}

export interface GraphPatchPreview {
  patch: {
    schema_version: "assurance.graph_patch.v1";
    patch_id: string;
    base_source_graph_hash: string;
    operations: Array<Record<string, unknown>>;
  };
  before_source_graph_hash: string;
  after_source_graph_hash: string;
  diff: string[] | string;
}
