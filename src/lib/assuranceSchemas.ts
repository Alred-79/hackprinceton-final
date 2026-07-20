import { z } from "zod";

const stableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const semver = z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*[1-9])?Z$/);
const decimal = z.string().regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/);
const jsonObject = z.record(z.string(), z.unknown());
const nodeType = z.enum([
  "input", "output", "executor", "evaluator", "router", "web_search", "file_rw",
  "context_gate", "tool_rag", "fallback_router", "code_exec", "api_call",
  "human_review", "mcp_server", "kafka_stream", "typed_handoff_gate", "evidence_check",
]);
const edgeKind = z.enum(["normal", "conditional", "failure", "retry"]);
const outputMode = z.enum(["tool", "native", "prompted"]);

const registryDigests = z.object({
  capability_registry_digest: sha256,
  lowerer_registry_digest: sha256,
  contract_registry_digest: sha256,
  check_registry_digest: sha256,
}).strict();

const producedContract = z.object({
  contract_id: stableId,
  contract_version: semver,
  supported_output_modes: z.array(outputMode),
}).strict();

const port = z.object({
  id: stableId,
  direction: z.enum(["input", "output"]),
  payload_contract_id: stableId,
  payload_contract_version: semver,
  cardinality: z.enum(["one", "many"]),
}).strict();

const stateBinding = z.object({
  source: z.enum(["request.input", "incoming.payload", "incoming.payloads"]),
  source_port: stableId.nullable(),
  target_state_key: stableId,
  merge: z.enum(["replace", "ordered_list"]),
}).strict();

const nodeCapability = z.object({
  scenario_id: z.string(),
  node_type: nodeType,
  capability_template_id: stableId,
  operation_id: stableId,
  operation_version: semver,
  config_schema_id: stableId,
  config_schema_version: semver,
  input_ports: z.array(port),
  output_ports: z.array(port),
  input_bindings: z.array(stateBinding),
  state_reads: z.array(stableId),
  state_writes: z.array(stableId),
  state_reducers: z.record(stableId, z.enum(["replace", "ordered_list"])),
  lowerer_id: stableId,
  lowerer_version: semver,
  reentry_supported: z.boolean(),
  default_config: jsonObject,
  supported_edge_kinds: z.array(edgeKind),
  allowed_executor_contracts: z.array(producedContract),
  operation_role: z.enum(["input", "terminal", "handoff_producer", "transform", "router"]),
  config_constraints: jsonObject,
  produced_payload_contracts: z.array(producedContract),
}).strict();

const contract = z.object({
  contract_id: stableId,
  version: semver,
  kind: z.enum(["output", "handoff", "envelope"]),
  json_schema_digest: sha256,
  json_schema: jsonObject,
  supported_output_modes: z.array(outputMode),
}).strict();

const check = z.object({
  check_id: stableId,
  version: semver,
  title: z.string(),
  engine: z.literal("deterministic"),
  method: z.string(),
  threshold: decimal,
  implementation_fingerprint: sha256,
}).strict();

export const capabilitiesResponseSchema = z.object({
  schema_version: z.literal("assurance.capabilities.v1"),
  enabled: z.literal(true),
  supported: z.boolean(),
  scenario_id: z.string(),
  adapter_version: semver.nullable(),
  compiler_version: semver,
  run_input_schema: jsonObject,
  node_capabilities: z.array(nodeCapability),
  contracts: z.array(contract),
  checks: z.array(check),
  patches: z.array(jsonObject),
  eval_suites: z.array(z.object({
    suite_id: stableId,
    version: semver,
    case_ids: z.array(stableId),
  }).strict()),
  registry_digests: z.union([
    registryDigests,
    z.object({ unsupported: z.string() }).strict(),
    z.object({}).strict(),
  ]),
  help_text: z.record(z.string(), z.string()),
}).strict();

const compileIssue = z.object({
  code: stableId,
  message: z.string(),
  node_id: stableId.nullable().optional(),
  edge_id: stableId.nullable().optional(),
  path: z.array(z.union([z.string(), z.number().int()])),
}).strict();

const planStep = z.object({
  step_id: stableId,
  canvas_node_id: stableId,
  node_type: nodeType,
  config: jsonObject,
  operation_id: stableId,
  operation_version: semver,
  lowerer_id: stableId,
  lowerer_version: semver,
  implementation_fingerprint: sha256,
  produced_payload_contracts: z.array(producedContract),
  state_writes: z.array(stableId),
  state_reducers: z.record(stableId, z.enum(["replace", "ordered_list"])),
  reentry_supported: z.boolean(),
  internal: z.boolean(),
}).strict();

const planTransition = z.object({
  transition_id: stableId,
  canvas_edge_id: stableId,
  source_step_id: stableId,
  target_step_id: stableId,
  source_handle: stableId,
  target_handle: stableId,
  kind: edgeKind,
  fan_out: z.enum(["all", "exclusive"]).nullable(),
  route_probability: decimal.nullable(),
  max_attempts: z.number().int().nullable(),
  cleared_state_keys: z.array(stableId).nullable().optional(),
  cleared_canvas_node_ids: z.array(stableId).nullable().optional(),
  replacement_state_key: stableId.nullable().optional(),
  must_revisit_step_id: stableId.nullable().optional(),
}).strict();

export const compileResponseSchema = z.object({
  schema_version: z.literal("assurance.compile_result.v1"),
  artifact_id: uuid,
  scenario_id: z.string(),
  status: z.literal("compiled"),
  source_graph_hash: sha256,
  candidate_hash: sha256,
  normalized_semantic_graph: jsonObject,
  compiled_plan: z.object({
    schema_version: z.literal("assurance.plan.v1"),
    steps: z.array(planStep),
    transitions: z.array(planTransition),
    entry_step_ids: z.array(stableId),
    terminal_step_ids: z.array(stableId),
  }).strict(),
  node_to_plan_steps: z.record(stableId, z.array(stableId)),
  edge_to_plan_transitions: z.record(stableId, z.array(stableId)),
  resolved_assurance: z.record(stableId, jsonObject),
  registry_digests: registryDigests,
  issues: z.array(compileIssue),
  warnings: z.array(compileIssue),
  created_at: timestamp,
}).strict();

const validationError = z.object({
  path: z.array(z.union([z.string(), z.number().int()])),
  type: z.string(),
  message: z.string(),
  input: z.literal("[redacted]"),
}).strict();

const eventBase = {
  event_id: uuid,
  run_id: uuid,
  sequence: z.number().int().positive(),
  attempt_number: z.number().int().positive(),
  timestamp,
  correlation_id: uuid,
  causation_id: uuid.nullable(),
  candidate_hash: sha256,
  canvas_node_id: stableId.nullable(),
  canvas_edge_id: stableId.nullable(),
  plan_step_id: stableId.nullable(),
};

const event = z.discriminatedUnion("event_type", [
  z.object({ ...eventBase, event_type: z.literal("run_started"), payload: z.object({ artifact_id: uuid }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("node_started"), payload: z.object({ incoming_canvas_edge_id: stableId.nullable() }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("node_completed"), payload: z.object({ selected_handle: stableId.nullable(), terminal: z.literal(true).nullable() }).strict().refine((value) => (value.selected_handle === null) !== (value.terminal === null)) }).strict(),
  z.object({ ...eventBase, event_type: z.literal("node_failed"), payload: z.object({ code: stableId, errors: z.array(validationError) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("executor_output_rejected"), payload: z.object({ contract_id: stableId, errors: z.array(validationError) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("executor_retry_started"), payload: z.object({ validation_retry: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("executor_output_validated"), payload: z.object({ contract_id: stableId, contract_version: semver, output_mode: outputMode, strict: z.boolean(), request_count: z.number().int().positive(), retry_count: z.number().int().nonnegative(), engine: z.literal("pydantic_ai") }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("fixture_mutation_applied"), payload: z.object({ mutation_id: z.literal("post_agent_handoff_drift"), target_contract_id: stableId, removed_path: z.array(z.union([z.string(), z.number().int()])) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("handoff_validated"), payload: z.object({ contract_id: stableId, contract_version: semver, method: z.enum(["validate_python", "validate_json"]) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("handoff_rejected"), payload: z.object({ contract_id: stableId, contract_version: semver, method: z.enum(["validate_python", "validate_json"]), errors: z.array(validationError) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("knowledge_retrieval_completed"), payload: z.object({ operation_id: stableId, corpus_id: stableId, retrieval_mode: z.enum(["bm25", "vector", "hybrid"]), top_k: z.number().int().min(1).max(20), query: z.string(), retrieved: z.array(z.object({ chunk_id: stableId, source_id: stableId, rank: z.number().int().positive(), score: decimal, relevant: z.boolean(), title: z.string(), excerpt: z.string() }).strict()), metrics: z.object({ metric_family: z.literal("ragas_aligned_deterministic"), context_precision: decimal, context_recall: decimal, context_relevance: decimal, faithfulness: z.null(), faithfulness_status: z.literal("not_measured_requires_generation") }).strict() }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("evidence_check_started"), payload: z.object({ check_ids: z.array(stableId) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("evidence_check_result"), payload: z.object({ check_id: stableId, version: semver, score: decimal, decision: z.boolean(), weight: decimal.nullable(), engine: z.literal("deterministic"), method: stableId, implementation_fingerprint: sha256, evidence_refs: z.array(z.string()) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("edge_traversed"), payload: z.object({ source_handle: stableId, target_handle: stableId, kind: edgeKind }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("outer_revision_started"), payload: z.object({ cleared_state_keys: z.array(stableId), replacement_state_key: stableId, must_revisit_step_id: stableId, revision_feedback: z.array(validationError) }).strict() }).strict(),
  z.object({ ...eventBase, event_type: z.literal("run_finished"), payload: z.object({ terminal_kind: z.enum(["clean", "recovered", "contract_violation", "evidence_failed", "revision_exhausted", "run_error"]), code: stableId.nullable() }).strict() }).strict(),
]);

const terminalBase = {
  output: z.unknown(),
  code: stableId.nullable(),
  proof_event_ids: z.array(uuid),
  recovered_from_event_ids: z.array(uuid),
};
const terminal = z.discriminatedUnion("kind", [
  z.object({ ...terminalBase, kind: z.literal("clean") }).strict(),
  z.object({ ...terminalBase, kind: z.literal("recovered") }).strict(),
  z.object({ ...terminalBase, kind: z.literal("contract_violation") }).strict(),
  z.object({ ...terminalBase, kind: z.literal("evidence_failed") }).strict(),
  z.object({ ...terminalBase, kind: z.literal("revision_exhausted") }).strict(),
  z.object({ ...terminalBase, kind: z.literal("run_error") }).strict(),
]);

export const runResponseSchema = z.object({
  schema_version: z.literal("assurance.run_result.v1"),
  run_id: uuid,
  artifact_id: uuid,
  candidate_hash: sha256,
  status: z.literal("completed"),
  terminal_result: terminal,
  events: z.array(event).min(1),
  internal_executor_calls: z.record(stableId, z.number().int().nonnegative()),
  internal_executor_retries: z.record(stableId, z.number().int().nonnegative()),
  outer_revisions: z.object({
    used: z.number().int().nonnegative(),
    budget: z.number().int().min(0).max(3),
    by_gate: z.record(stableId, z.number().int().nonnegative()),
    traversed_edge_ids: z.array(stableId),
  }).strict(),
  containment_evidence: z.object({
    measurement_status: z.enum(["measured", "not_measured"]),
    injected_risk_ids: z.array(stableId),
    contained_risk_ids: z.array(stableId),
    decision: z.boolean().nullable(),
  }).strict(),
  created_at: timestamp,
  finished_at: timestamp,
}).strict().superRefine((value, context) => {
  value.events.forEach((item, index) => {
    if (item.sequence !== index + 1) context.addIssue({ code: "custom", message: "event sequence is not contiguous", path: ["events", index, "sequence"] });
    if (item.run_id !== value.run_id || item.correlation_id !== value.run_id) context.addIssue({ code: "custom", message: "event run identity mismatch", path: ["events", index] });
    if (item.candidate_hash !== value.candidate_hash) context.addIssue({ code: "custom", message: "event candidate mismatch", path: ["events", index] });
    const expectedCause = index === 0 ? null : value.events[index - 1].event_id;
    if (item.causation_id !== expectedCause) context.addIssue({ code: "custom", message: "event causation chain mismatch", path: ["events", index, "causation_id"] });
  });
  if (value.events[0]?.event_type !== "run_started") context.addIssue({ code: "custom", message: "run_started must be first", path: ["events", 0] });
  const final = value.events.at(-1);
  if (final?.event_type !== "run_finished") context.addIssue({ code: "custom", message: "run_finished must be final", path: ["events"] });
  if (value.events.filter((item) => item.event_type === "run_finished").length !== 1) context.addIssue({ code: "custom", message: "run_finished must occur exactly once", path: ["events"] });
  if (final?.event_type === "run_finished" && (final.payload.terminal_kind !== value.terminal_result.kind || final.payload.code !== value.terminal_result.code)) context.addIssue({ code: "custom", message: "terminal result does not match run_finished", path: ["terminal_result"] });
  if (value.containment_evidence.measurement_status === "not_measured" && value.containment_evidence.decision !== null) context.addIssue({ code: "custom", message: "unmeasured containment cannot claim a decision", path: ["containment_evidence", "decision"] });
  if (value.containment_evidence.measurement_status === "measured" && value.containment_evidence.injected_risk_ids.length === 0) context.addIssue({ code: "custom", message: "measured containment requires tracked risks", path: ["containment_evidence", "injected_risk_ids"] });
});

export const evalResponseSchema = z.object({
  schema_version: z.literal("assurance.eval_result.v1"),
  eval_id: uuid,
  artifact_id: uuid,
  candidate_hash: sha256,
  suite_id: stableId,
  suite_version: semver,
  status: z.literal("completed"),
  engine: z.literal("pydantic-evals"),
  aggregate: z.object({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict(),
  cases: z.array(z.object({
    case_id: stableId,
    case_version: semver,
    evaluator_id: stableId,
    evaluator_version: semver,
    run_id: uuid,
    passed: z.boolean(),
    result: jsonObject,
  }).strict()),
  cache_key: sha256,
  created_at: timestamp,
  finished_at: timestamp,
}).strict().refine((value) => value.aggregate.total === value.cases.length && value.aggregate.passed + value.aggregate.failed === value.aggregate.total, { message: "eval aggregate does not match cases" });

export type CapabilitiesWire = z.infer<typeof capabilitiesResponseSchema>;
export type CompileWire = z.infer<typeof compileResponseSchema>;
export type RunWire = z.infer<typeof runResponseSchema>;
export type EvalWire = z.infer<typeof evalResponseSchema>;
