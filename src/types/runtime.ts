export type RunStatus = "running" | "paused" | "succeeded" | "failed";
export type RunVariant = "baseline" | "hardened";
export type RuntimeConnectionStatus = "checking" | "online" | "offline";

export interface RuntimeScenarioDefinition {
  scenario_id: string;
  title: string;
  summary: string;
  producer_name: string;
  consumer_name: string;
  contracts: {
    input: string;
    handoff: string;
    output: string;
  };
  fixture_presets: Record<string, string>;
  default_fixture_preset: string | null;
  pydantic_lessons: string[];
  eval_case_count: number;
}

export interface RuntimeCapabilities {
  executable_scenarios: string[];
  design_only_scenarios: string[];
  contracts: string[];
  guarantees: string[];
  operations: string[];
  limitations: string[];
  scenario_runtimes: RuntimeScenarioDefinition[];
}

export interface ModelClaim {
  id: string;
  statement: string;
  citation_ids: string[];
  declared_parent_claim_ids: string[];
  declared_confidence?: number;
  declared_status?: "observed" | "inferred" | "unverified";
}

export interface ClaimAssessment {
  claim_fingerprint: string;
  claim_id: string;
  node_id: string;
  assessment: "supported" | "contradicted" | "unsupported" | "unknown";
  matched_fixture_fact_ids: string[];
  matched_parent_fingerprints: string[];
  assessment_method: string;
  assessment_version: string;
}

export interface RunEvent {
  event_id: string;
  run_id: string;
  node_id: string | null;
  kind: string;
  started_at: string;
  ended_at: string | null;
  attempt: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  validation_errors: string[];
  metadata: Record<string, unknown>;
}

export interface PendingApproval {
  approval_id: string;
  run_id: string;
  checkpoint_id: string;
  tool_call_id: string;
  validated_args_hash: string;
  config_hash: string;
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  arguments: Record<string, unknown>;
}

export interface RunMetrics {
  duration_ms: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  first_attempt_contract_pass: boolean;
  final_contract_pass: boolean;
  task_pass: boolean | null;
  containment: boolean | null;
  propagation_depth: number;
  blast_radius: number | null;
  critical_output_escape: boolean | null;
  unknown_assessment_rate: number;
  labels: Record<string, "measurement" | "calculated" | "structural" | "not_measured">;
}

export interface PydanticEvidence {
  evidence_id: string;
  node_id: string;
  layer: "input_contract" | "agent_output" | "edge_contract" | "tool_arguments" | "task_quality";
  contract_name: string | null;
  status: "passed" | "repaired" | "rejected" | "failed" | "not_applicable";
  title: string;
  explanation: string;
  attempt: number;
  validation_errors: Array<Record<string, unknown>>;
  schema_excerpt: Record<string, unknown>;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: Record<string, unknown> | null;
  guarantee: "contract" | "factuality" | "citation" | "policy" | "task_quality";
  teaching_note: string;
}

export interface RunRecord {
  run_id: string;
  trace_id: string;
  scenario_id: string;
  variant: RunVariant;
  run_mode: "fixture" | "live";
  terminal_status: RunStatus;
  started_at: string;
  ended_at: string | null;
  failure_reason: string | null;
  runtime_build_hash: string;
  fixture_set_version: string | null;
  workflow_hash: string;
  config_hash: string;
  input: Record<string, unknown>;
  fault_plan: Array<Record<string, unknown>>;
  events: RunEvent[];
  claim_assessments: ClaimAssessment[];
  outputs: Record<string, unknown>;
  pending_approvals: PendingApproval[];
  metrics: RunMetrics | null;
  pydantic_evidence: PydanticEvidence[];
  semantic_trace_hash: string | null;
  operation: "execute" | "fixture_replay" | "checkpoint_fork" | "candidate_rerun";
  compared_to_run_id: string | null;
  replay_comparison: {
    semantic_trace_match: boolean;
    original_semantic_trace_hash: string;
    replay_semantic_trace_hash: string;
    external_requests: number;
    volatile_fields_excluded: string[];
  } | null;
  external_requests: number;
  fixture_preset: string | null;
}

export interface EvalCaseResult {
  name: string;
  version: string;
  passed: boolean;
  assertions: Record<string, boolean>;
  metrics: Record<string, number | string | boolean | null>;
  mutation_plan: Record<string, unknown>;
  evidence: string[];
}

export interface EvalReport {
  report_id: string;
  suite_version: string;
  generated_at: string;
  engine: string;
  cases: EvalCaseResult[];
  passed: number;
  failed: number;
}
