import type { EvalReport, RunRecord, RuntimeCapabilities, RunVariant } from "@/types/runtime";

const API_BASE = import.meta.env.VITE_RUNTIME_API_URL ?? "http://localhost:8000";

export class RuntimeApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.detail;
      const message = typeof detail === "string"
        ? detail
        : detail?.message ?? `Runtime request failed (${response.status})`;
      throw new RuntimeApiError(message, response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RuntimeApiError("The runtime did not respond before the request timeout.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const runtimeApi = {
  health: () => request<{ status: string; runtime_build_hash: string }>("/api/health", undefined, 5_000),
  capabilities: () => request<RuntimeCapabilities>("/api/capabilities", undefined, 5_000),
  run: (
    scenarioId: string,
    variant: RunVariant,
    fixturePreset?: string | null,
  ) => request<RunRecord>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      scenario_id: scenarioId,
      variant,
      run_mode: "fixture",
      input: {},
      fixture_preset: fixturePreset ?? null,
    }),
  }),
  resume: (
    runId: string,
    approvalId: string,
    decision: "approved" | "denied",
  ) => request<RunRecord>(`/api/runs/${runId}/resume`, {
    method: "POST",
    body: JSON.stringify({
      pending_approval_id: approvalId,
      decision,
      idempotency_key: `${decision}-${crypto.randomUUID()}`,
    }),
  }),
  replay: (runId: string) => request<RunRecord>(`/api/runs/${runId}/fixture-replay`, {
    method: "POST",
    body: "{}",
  }),
  evals: (scenarioId: string) => request<EvalReport>("/api/evals/run", {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId, cases: null }),
  }, 90_000),
};
