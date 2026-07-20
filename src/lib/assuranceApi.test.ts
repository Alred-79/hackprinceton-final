import { describe, expect, it } from "vitest";
import {
  assertAssuranceCapabilitiesResponse,
  assertAssuranceCompileResponse,
  assertAssuranceEvalResponse,
  assertAssuranceRunResponse,
} from "./assuranceApi";

const runId = "00000000-0000-4000-8000-000000000001";
const artifactId = "00000000-0000-4000-8000-000000000002";
const firstEventId = "00000000-0000-4000-8000-000000000003";
const finalEventId = "00000000-0000-4000-8000-000000000004";
const hash = "a".repeat(64);
const timestamp = "2026-07-20T12:00:00Z";
const digests = {
  capability_registry_digest: hash,
  lowerer_registry_digest: hash,
  contract_registry_digest: hash,
  check_registry_digest: hash,
};

const capabilities = {
  schema_version: "assurance.capabilities.v1",
  enabled: true,
  supported: true,
  scenario_id: "gold-plater",
  adapter_version: "1.0.0",
  compiler_version: "1.0.0",
  run_input_schema: {},
  node_capabilities: [{
    scenario_id: "gold-plater",
    node_type: "executor",
    capability_template_id: "cap.executor@1",
    operation_id: "classify_task",
    operation_version: "1.0.0",
    config_schema_id: "cfg.executor@1",
    config_schema_version: "1.0.0",
    input_ports: [{ id: "in", direction: "input", payload_contract_id: "payload", payload_contract_version: "1.0.0", cardinality: "many" }],
    output_ports: [{ id: "success", direction: "output", payload_contract_id: "payload", payload_contract_version: "1.0.0", cardinality: "one" }],
    input_bindings: [{ source: "incoming.payloads", source_port: "in", target_state_key: "executor.inputs", merge: "ordered_list" }],
    state_reads: ["incoming.payloads"],
    state_writes: ["node.success"],
    state_reducers: { "node.success": "replace" },
    lowerer_id: "lower.gold-plater.classify_task",
    lowerer_version: "1.0.0",
    reentry_supported: true,
    default_config: {},
    supported_edge_kinds: ["normal", "failure", "retry"],
    allowed_executor_contracts: [{ contract_id: "scope_handoff", contract_version: "1.0.0", supported_output_modes: ["tool"] }],
    operation_role: "handoff_producer",
    config_constraints: {},
    produced_payload_contracts: [{ contract_id: "scope_handoff", contract_version: "1.0.0", supported_output_modes: ["tool"] }],
  }],
  contracts: [{
    contract_id: "scope_handoff",
    version: "1.0.0",
    kind: "handoff",
    json_schema_digest: hash,
    json_schema: {},
    supported_output_modes: ["tool"],
  }],
  checks: [{
    check_id: "authorization_scope",
    version: "1.0.0",
    title: "Authorization Scope",
    engine: "deterministic",
    method: "assurance.check.authorization_scope.v1",
    threshold: "1",
    implementation_fingerprint: hash,
  }],
  patches: [],
  eval_suites: [{ suite_id: "gold-plater-assurance", version: "1.0.0", case_ids: ["clean"] }],
  registry_digests: digests,
  help_text: { executor: "Typed output" },
};

const compiled = {
  schema_version: "assurance.compile_result.v1",
  artifact_id: artifactId,
  scenario_id: "gold-plater",
  status: "compiled",
  source_graph_hash: hash,
  candidate_hash: hash,
  normalized_semantic_graph: {},
  compiled_plan: {
    schema_version: "assurance.plan.v1",
    steps: [],
    transitions: [],
    entry_step_ids: [],
    terminal_step_ids: [],
  },
  node_to_plan_steps: {},
  edge_to_plan_transitions: {},
  resolved_assurance: {},
  registry_digests: digests,
  issues: [],
  warnings: [],
  created_at: timestamp,
};

const validRun = {
  schema_version: "assurance.run_result.v1",
  run_id: runId,
  artifact_id: artifactId,
  candidate_hash: hash,
  status: "completed",
  terminal_result: {
    kind: "clean",
    output: null,
    code: null,
    proof_event_ids: [],
    recovered_from_event_ids: [],
  },
  events: [
    {
      event_id: firstEventId,
      run_id: runId,
      sequence: 1,
      event_type: "run_started",
      attempt_number: 1,
      timestamp,
      correlation_id: runId,
      causation_id: null,
      candidate_hash: hash,
      canvas_node_id: null,
      canvas_edge_id: null,
      plan_step_id: null,
      payload: { artifact_id: artifactId },
    },
    {
      event_id: finalEventId,
      run_id: runId,
      sequence: 2,
      event_type: "run_finished",
      attempt_number: 1,
      timestamp,
      correlation_id: runId,
      causation_id: firstEventId,
      candidate_hash: hash,
      canvas_node_id: null,
      canvas_edge_id: null,
      plan_step_id: null,
      payload: { terminal_kind: "clean", code: null },
    },
  ],
  internal_executor_calls: {},
  internal_executor_retries: {},
  outer_revisions: { used: 0, budget: 0, by_gate: {}, traversed_edge_ids: [] },
  containment_evidence: { measurement_status: "not_measured", injected_risk_ids: [], contained_risk_ids: [], decision: null },
  created_at: timestamp,
  finished_at: timestamp,
};

const evaluated = {
  schema_version: "assurance.eval_result.v1",
  eval_id: "00000000-0000-4000-8000-000000000005",
  artifact_id: artifactId,
  candidate_hash: hash,
  suite_id: "gold-plater-assurance",
  suite_version: "1.0.0",
  status: "completed",
  engine: "pydantic-evals",
  aggregate: { passed: 1, failed: 0, total: 1 },
  cases: [{
    case_id: "clean",
    case_version: "1.0.0",
    evaluator_id: "linked-run-integrity",
    evaluator_version: "1.0.0",
    run_id: runId,
    passed: true,
    result: {},
  }],
  cache_key: hash,
  created_at: timestamp,
  finished_at: timestamp,
};

describe("strict assurance response boundaries", () => {
  it("accepts complete exact capabilities, compile, run, and eval contracts", () => {
    expect(() => assertAssuranceCapabilitiesResponse(capabilities)).not.toThrow();
    expect(() => assertAssuranceCompileResponse(compiled)).not.toThrow();
    expect(() => assertAssuranceRunResponse(validRun)).not.toThrow();
    expect(() => assertAssuranceEvalResponse(evaluated)).not.toThrow();
  });

  it("accepts visible Pydantic AI validation evidence on a clean run", () => {
    const validatedEventId = "00000000-0000-4000-8000-000000000006";
    const events = [
      validRun.events[0],
      {
        event_id: validatedEventId,
        run_id: runId,
        sequence: 2,
        event_type: "executor_output_validated",
        attempt_number: 1,
        timestamp,
        correlation_id: runId,
        causation_id: firstEventId,
        candidate_hash: hash,
        canvas_node_id: "executor",
        canvas_edge_id: null,
        plan_step_id: "step:executor",
        payload: {
          contract_id: "implementation_result",
          contract_version: "1.0.0",
          output_mode: "tool",
          strict: true,
          request_count: 1,
          retry_count: 0,
          engine: "pydantic_ai",
        },
      },
      { ...validRun.events[1], sequence: 3, causation_id: validatedEventId },
    ];
    expect(() => assertAssuranceRunResponse({
      ...validRun,
      events,
      internal_executor_calls: { executor: 1 },
      internal_executor_retries: { executor: 0 },
    })).not.toThrow();
  });

  it("accepts inspectable Knowledge Retrieval evidence and rejects a fabricated faithfulness score", () => {
    const retrievalEventId = "00000000-0000-4000-8000-000000000008";
    const retrieval = {
      event_id: retrievalEventId,
      run_id: runId,
      sequence: 2,
      event_type: "knowledge_retrieval_completed",
      attempt_number: 1,
      timestamp,
      correlation_id: runId,
      causation_id: firstEventId,
      candidate_hash: hash,
      canvas_node_id: "knowledge",
      canvas_edge_id: null,
      plan_step_id: "step:knowledge",
      payload: {
        operation_id: "retrieve_intel_knowledge",
        corpus_id: "threat-intel-fixture-v1",
        retrieval_mode: "hybrid",
        top_k: 1,
        query: "Northstar 198.51.100.42",
        retrieved: [{
          chunk_id: "intel-ip-198-51-100-42",
          source_id: "intel-ledger",
          rank: 1,
          score: "0.91",
          relevant: true,
          title: "Observed command-and-control indicator",
          excerpt: "Fixture evidence",
        }],
        metrics: {
          metric_family: "ragas_aligned_deterministic",
          context_precision: "1",
          context_recall: "0.333",
          context_relevance: "0.91",
          faithfulness: null,
          faithfulness_status: "not_measured_requires_generation",
        },
      },
    };
    const run = {
      ...validRun,
      events: [validRun.events[0], retrieval, { ...validRun.events[1], sequence: 3, causation_id: retrievalEventId }],
    };
    expect(() => assertAssuranceRunResponse(run)).not.toThrow();
    expect(() => assertAssuranceRunResponse({
      ...run,
      events: [
        validRun.events[0],
        { ...retrieval, payload: { ...retrieval.payload, metrics: { ...retrieval.payload.metrics, faithfulness: "0.95" } } },
        { ...validRun.events[1], sequence: 3, causation_id: retrievalEventId },
      ],
    })).toThrow(/run/);
  });

  it("accepts an explicit external handoff-mutation event", () => {
    const mutationEventId = "00000000-0000-4000-8000-000000000007";
    expect(() => assertAssuranceRunResponse({
      ...validRun,
      events: [
        validRun.events[0],
        {
          event_id: mutationEventId,
          run_id: runId,
          sequence: 2,
          event_type: "fixture_mutation_applied",
          attempt_number: 1,
          timestamp,
          correlation_id: runId,
          causation_id: firstEventId,
          candidate_hash: hash,
          canvas_node_id: "executor",
          canvas_edge_id: null,
          plan_step_id: "step:executor",
          payload: {
            mutation_id: "post_agent_handoff_drift",
            target_contract_id: "scope_handoff",
            removed_path: ["requested_scope"],
          },
        },
        { ...validRun.events[1], sequence: 3, causation_id: mutationEventId },
      ],
    })).not.toThrow();
  });

  it("rejects extra fields at every top-level response boundary", () => {
    expect(() => assertAssuranceCapabilitiesResponse({ ...capabilities, surprise: true })).toThrow(/capabilities/);
    expect(() => assertAssuranceCompileResponse({ ...compiled, surprise: true })).toThrow(/compile/);
    expect(() => assertAssuranceRunResponse({ ...validRun, surprise: true })).toThrow(/run/);
    expect(() => assertAssuranceEvalResponse({ ...evaluated, surprise: true })).toThrow(/eval/);
  });

  it("rejects malformed IDs, hashes, timestamps, and nested event payload extras", () => {
    expect(() => assertAssuranceCompileResponse({ ...compiled, candidate_hash: "not-a-hash" })).toThrow(/compile/);
    expect(() => assertAssuranceRunResponse({ ...validRun, run_id: "NOT-A-CANONICAL-UUID" })).toThrow(/run/);
    expect(() => assertAssuranceRunResponse({ ...validRun, created_at: "2026-07-20T12:00:00+00:00" })).toThrow(/run/);
    const events = structuredClone(validRun.events);
    events[0].payload = { ...events[0].payload, extra: true } as typeof events[0]["payload"];
    expect(() => assertAssuranceRunResponse({ ...validRun, events })).toThrow(/run/);
  });

  it("rejects event ordering, causation, terminal, containment, and eval aggregate drift", () => {
    expect(() => assertAssuranceRunResponse({ ...validRun, events: [{ ...validRun.events[1], sequence: 1, causation_id: null }] })).toThrow(/run/);
    const brokenCause = structuredClone(validRun.events);
    brokenCause[1].causation_id = artifactId;
    expect(() => assertAssuranceRunResponse({ ...validRun, events: brokenCause })).toThrow(/run/);
    expect(() => assertAssuranceRunResponse({ ...validRun, terminal_result: { ...validRun.terminal_result, kind: "run_error" } })).toThrow(/run/);
    expect(() => assertAssuranceRunResponse({ ...validRun, containment_evidence: { ...validRun.containment_evidence, decision: true } })).toThrow(/run/);
    expect(() => assertAssuranceEvalResponse({ ...evaluated, aggregate: { passed: 2, failed: 0, total: 2 } })).toThrow(/eval/);
  });
});
