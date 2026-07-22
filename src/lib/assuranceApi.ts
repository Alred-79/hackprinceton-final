import type {
  AssuranceArtifact,
  AssuranceCapabilities,
  AssuranceEvalResult,
  AssuranceRunResult,
  GraphPatchPreview,
  SimulatorGraphWire,
} from "@/types/assurance";
import {
  capabilitiesResponseSchema,
  compileResponseSchema,
  evalResponseSchema,
  runResponseSchema,
  type CapabilitiesWire,
  type RunWire,
} from "@/lib/assuranceSchemas";
import type { ZodType } from "zod";

const API_BASE = import.meta.env.VITE_RUNTIME_API_URL
  ?? (import.meta.env.PROD ? "" : "http://localhost:8000");

export const ASSURANCE_CLIENT_ENABLED = import.meta.env.VITE_ASSURANCE_V1 === "true";

export class AssuranceApiError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: unknown) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoundary<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AssuranceApiError(
      `The assurance runtime returned a malformed ${label} contract.`,
      502,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function request(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = isRecord(body) ? body.detail : undefined;
      const issue = Array.isArray(detail) ? detail[0] : detail;
      const message = typeof detail === "string"
        ? detail
        : isRecord(issue) && typeof (issue.message ?? issue.msg) === "string"
          ? String(issue.message ?? issue.msg)
          : `Assurance request failed (${response.status})`;
      throw new AssuranceApiError(message, response.status, detail);
    }
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AssuranceApiError("The assurance runtime timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function titleFromId(value: string): string {
  return value.replace(/[@._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultConfigFromServer(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return {
    label: value.label,
    model: value.model,
    systemPrompt: value.system_prompt,
    tools: value.tools,
    routingPrompt: value.routing_prompt,
    routes: value.routes,
    servedTools: value.served_tools,
    kValue: value.k_value,
    retrievalMode: value.retrieval_mode,
    endpoint: value.endpoint,
    validatorId: value.validator_id,
    contextGateMode: value.context_gate_mode,
    handoffBrief: value.handoff_brief,
    reviewType: value.review_type,
  };
}

function normalizeCapabilities(value: CapabilitiesWire): AssuranceCapabilities {
  const contracts = value.contracts;
  return {
    enabled: value.enabled,
    supported: value.supported,
    scenario_id: value.scenario_id,
    adapter_version: value.adapter_version ?? undefined,
    compiler_version: value.compiler_version,
    operations: value.node_capabilities.map((operation) => ({
      operation_id: operation.operation_id,
      operation_version: operation.operation_version,
      node_type: operation.node_type,
      label: titleFromId(operation.operation_id),
      default_config: defaultConfigFromServer(operation.default_config),
      ports: [
        ...operation.input_ports.map((value) => ({ id: value.id, direction: "input" as const })),
        ...operation.output_ports.map((value) => ({ id: value.id, direction: "output" as const })),
      ],
      allowed_executor_contracts: operation.allowed_executor_contracts,
      operation_role: operation.operation_role,
      config_constraints: operation.config_constraints,
      produced_payload_contracts: operation.produced_payload_contracts,
    })),
    output_contracts: contracts.filter((item) => item.kind === "output").map((item) => ({
      contract_id: item.contract_id,
      contract_version: item.version,
      label: titleFromId(item.contract_id),
      json_schema_digest: item.json_schema_digest,
      json_schema: item.json_schema,
      supported_output_modes: item.supported_output_modes,
    })),
    handoff_contracts: contracts.filter((item) => item.kind === "handoff").map((item) => ({
      contract_id: item.contract_id,
      contract_version: item.version,
      label: titleFromId(item.contract_id),
      json_schema_digest: item.json_schema_digest,
      json_schema: item.json_schema,
      supported_output_modes: item.supported_output_modes,
    })),
    evidence_checks: value.checks.map((item) => ({
      check_id: item.check_id,
      check_version: item.version,
      label: item.title ?? titleFromId(item.check_id),
      engine: item.engine,
      method: item.method,
    })),
    eval_suites: value.eval_suites.map((item) => ({
      suite_id: item.suite_id,
      suite_version: item.version,
      label: titleFromId(item.suite_id),
    })),
    patches: value.patches
      .filter((item): item is Record<string, unknown> & { patch_id: string } => typeof item.patch_id === "string")
      .map((item) => ({
        patch_id: item.patch_id,
        label: typeof item.label === "string" ? item.label : titleFromId(item.patch_id),
        description: typeof item.description === "string" ? item.description : undefined,
      })),
    help_text: value.help_text,
    unsupported_reason: value.unsupported_reason,
  };
}

export function assertAssuranceRunResponse(value: unknown): asserts value is RunWire {
  parseBoundary(runResponseSchema, value, "run");
}

export function assertAssuranceCapabilitiesResponse(value: unknown): void {
  parseBoundary(capabilitiesResponseSchema, value, "capabilities");
}

export function assertAssuranceCompileResponse(value: unknown): void {
  parseBoundary(compileResponseSchema, value, "compile");
}

export function assertAssuranceEvalResponse(value: unknown): void {
  parseBoundary(evalResponseSchema, value, "eval");
}

export const assuranceApi = {
  capabilities: async (scenarioId: string) => normalizeCapabilities(parseBoundary(
    capabilitiesResponseSchema,
    await request(`/api/assurance/capabilities/${encodeURIComponent(scenarioId)}`, undefined, 7_000),
    "capabilities",
  )),
  compile: async (scenarioId: string, graph: SimulatorGraphWire, maxOuterRevisions: number) =>
    parseBoundary(compileResponseSchema, await request("/api/assurance/compile", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "assurance.compile.v1",
        scenario_id: scenarioId,
        graph,
        execution_policy: { max_outer_revisions: maxOuterRevisions },
        seed_policy: "fixed",
        idempotency_key: crypto.randomUUID(),
      }),
    }), "compile"),
  run: async (artifact: AssuranceArtifact, input: Record<string, unknown>, seed = 7): Promise<AssuranceRunResult> => {
    const value = parseBoundary(runResponseSchema, await request("/api/assurance/runs", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "assurance.run.v1",
        artifact_id: artifact.artifact_id,
        candidate_hash: artifact.candidate_hash,
        input,
        deterministic_seed: seed,
        idempotency_key: crypto.randomUUID(),
      }),
    }, 90_000), "run");
    return {
      run_id: value.run_id,
      artifact_id: value.artifact_id,
      candidate_hash: value.candidate_hash,
      terminal_kind: value.terminal_result.kind,
      output: value.terminal_result.output,
      events: value.events,
      internal_retry_counts: value.internal_executor_retries,
      outer_revision_counts: value.outer_revisions,
      containment_evidence: value.containment_evidence,
    };
  },
  evals: async (artifact: AssuranceArtifact, suiteId: string, suiteVersion: string): Promise<AssuranceEvalResult> =>
    parseBoundary(evalResponseSchema, await request("/api/assurance/evals", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "assurance.eval.v1",
        artifact_id: artifact.artifact_id,
        candidate_hash: artifact.candidate_hash,
        suite_id: suiteId,
        suite_version: suiteVersion,
        seed_policy: "fixed",
        idempotency_key: crypto.randomUUID(),
      }),
    }, 120_000), "eval"),
  previewPatch: async (patchId: string, scenarioId: string, graph: SimulatorGraphWire, baseSourceGraphHash: string) =>
    await request(`/api/assurance/patches/${encodeURIComponent(patchId)}/preview`, {
      method: "POST",
      body: JSON.stringify({
        schema_version: "assurance.patch_preview.v1",
        scenario_id: scenarioId,
        graph,
        base_source_graph_hash: baseSourceGraphHash,
      }),
    }) as GraphPatchPreview,
};

export function defaultAssuranceInput(
  scenarioId: string,
  mode: "clean" | "invalid_output" | "handoff_drift" | "evidence_failure" = "clean",
): Record<string, unknown> {
  const now = "2026-07-20T12:00:00Z";
  const fixtures: Record<string, Record<string, unknown>> = {
    "threat-analyst": { kind: "threat-analyst", indicators: ["198.51.100.42"], observed_at: now, tenant_id: "demo-tenant" },
    "bloated-swarm": { kind: "bloated-swarm", query: "Where is order 1042?", customer_id: "demo-customer", channel: "chat" },
    "content-machine": { kind: "content-machine", content_brief: "Launch a trustworthy agent assurance guide", target_audience: "AI engineers", tone: "technical", format: "blog" },
    "due-diligence-engine": { kind: "due-diligence-engine", target_company: "Northstar Labs", deal_size_usd: "12500000", strategic_rationale: "Expand observability", concerns: ["customer concentration"] },
    "gold-plater": { kind: "gold-plater", task: "Add CSV export", constraints: ["No database changes"], authorization_scope: ["frontend export button"] },
    "mcp-migration": { kind: "mcp-migration", request: "Find the latest catalog entry", domain_hint: "research", resource_refs: ["catalog://demo"] },
    "ops-center": { kind: "ops-center", alert: "Checkout latency elevated", affected_systems: ["checkout-api"], observed_at: now, severity_hint: "unknown" },
    "safety-net": { kind: "safety-net", request: "Process the attached incident report", file_refs: ["fixture://incident.txt"], allow_partial: false },
  };
  const fixture = structuredClone(fixtures[scenarioId] ?? { kind: scenarioId });
  if (mode === "clean") return fixture;
  const evidenceMarkers: Record<string, string> = {
    "threat-analyst": "invented false claim",
    "bloated-swarm": "unauthorized tool",
    "content-machine": "invented citation",
    "due-diligence-engine": "unsupported finding",
    "gold-plater": "extra unauthorized work",
    "mcp-migration": "catalog bloat",
    "ops-center": "policy breach unapproved",
    "safety-net": "partial corrupt payload",
  };
  const marker = mode === "invalid_output"
    ? "invalid-output"
    : mode === "handoff_drift"
      ? "handoff-drift"
      : evidenceMarkers[scenarioId];
  const targetField: Record<string, string> = {
    "threat-analyst": "indicators",
    "bloated-swarm": "query",
    "content-machine": "content_brief",
    "due-diligence-engine": "target_company",
    "gold-plater": "task",
    "mcp-migration": "request",
    "ops-center": "alert",
    "safety-net": "request",
  };
  const field = targetField[scenarioId];
  if (Array.isArray(fixture[field])) fixture[field] = [marker];
  else fixture[field] = marker;
  return fixture;
}
