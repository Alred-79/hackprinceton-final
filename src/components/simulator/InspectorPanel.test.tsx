/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InspectorPanel } from "./InspectorPanel";
import { useAssuranceStore } from "@/store/assuranceStore";
import { useSimulatorStore } from "@/store/simulatorStore";
import type { AssuranceCapabilities, AssuranceRunResult } from "@/types/assurance";
import type { SimNode } from "@/types/simulator";

const capabilities: AssuranceCapabilities = {
  enabled: true,
  supported: true,
  scenario_id: "threat-analyst",
  operations: [
    {
      operation_id: "retrieve_intel_knowledge",
      operation_version: "1.0.0",
      node_type: "tool_rag",
      label: "Retrieve Intel Knowledge",
      default_config: { kValue: 5, retrievalMode: "hybrid" },
      ports: [
        { id: "in", direction: "input" },
        { id: "success", direction: "output" },
        { id: "failure", direction: "output" },
      ],
      config_constraints: {
        k_value: { minimum: 1, maximum: 20 },
        retrieval_modes: ["bm25", "vector", "hybrid"],
      },
    },
    {
      operation_id: "enrich_ioc",
      operation_version: "1.0.0",
      node_type: "executor",
      label: "Enrich IOC",
      ports: [
        { id: "in", direction: "input" },
        { id: "success", direction: "output" },
        { id: "failure", direction: "output" },
      ],
      allowed_executor_contracts: [
        {
          contract_id: "ioc_handoff",
          contract_version: "1.0.0",
          supported_output_modes: ["tool", "native", "prompted"],
        },
        {
          contract_id: "threat_report",
          contract_version: "2.0.0",
          supported_output_modes: ["tool", "native"],
        },
      ],
      produced_payload_contracts: [
        { contract_id: "ioc_handoff", contract_version: "1.0.0" },
      ],
      operation_role: "handoff_producer",
    },
  ],
  output_contracts: [
    {
      contract_id: "threat_report",
      contract_version: "2.0.0",
      label: "Threat Report",
      json_schema_digest: "a".repeat(64),
      json_schema: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          indicators: { type: "array", items: { type: "string" } },
        },
        required: ["severity", "indicators"],
      },
    },
  ],
  handoff_contracts: [
    {
      contract_id: "ioc_handoff",
      contract_version: "1.0.0",
      label: "IOC Handoff",
    },
  ],
  evidence_checks: [
    {
      check_id: "ioc_source_traceability",
      check_version: "1.0.0",
      label: "IOC Source Traceability",
      engine: "deterministic",
      method: "assurance.check.ioc_source_traceability.v1",
    },
  ],
};

const completedRun: AssuranceRunResult = {
  run_id: "00000000-0000-4000-8000-000000000001",
  artifact_id: "00000000-0000-4000-8000-000000000002",
  candidate_hash: "a".repeat(64),
  terminal_kind: "clean",
  events: [],
};

const executor: SimNode = {
  id: "exec-enricher",
  type: "executor",
  config: {
    label: "Threat Enricher",
    assuranceOperationId: "enrich_ioc",
    assuranceOperationVersion: "1.0.0",
  },
  position: { x: 0, y: 0 },
};

function setNodes(nodes: SimNode[]) {
  useSimulatorStore.setState({
    nodes,
    edges: [],
    selectedNodeId: null,
    history: [{ nodes: structuredClone(nodes), edges: [] }],
    historyIndex: 0,
    isEvaluating: false,
    activeRightTab: "results",
  });
}

function change(select: HTMLSelectElement | HTMLInputElement, value: string) {
  act(() => {
    if (select instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        select,
        value,
      );
      select.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      select.value = value;
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("assurance inspector interactions after a run", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useAssuranceStore.getState().clearForScenario();
    useAssuranceStore.setState({
      available: true,
      enabled: true,
      capabilities,
      status: "passed",
      run: completedRun,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useAssuranceStore.getState().clearForScenario();
  });

  it("selects a bound Executor after Run and configures Pydantic AI enforcement without a ref loop", () => {
    setNodes([executor]);
    act(() => root.render(<InspectorPanel />));
    act(() => useSimulatorStore.getState().selectNode("exec-enricher"));

    expect(container.textContent).toContain("Output Contract");
    const operation = container.querySelector<HTMLSelectElement>(
      '[aria-label="Threat Enricher runtime operation"]',
    );
    expect(operation?.value).toBe("enrich_ioc@1.0.0");

    const enable = container.querySelector<HTMLInputElement>(
      '[aria-label="Enable Pydantic AI output enforcement"]',
    );
    expect(enable).not.toBeNull();
    act(() => enable!.click());

    const contract = container.querySelector<HTMLSelectElement>(
      '[aria-label="Executor output contract"]',
    );
    const mode = container.querySelector<HTMLSelectElement>(
      '[aria-label="Executor output mode"]',
    );
    const retries = container.querySelector<HTMLInputElement>(
      '[aria-label="Executor validation retries"]',
    );
    expect(contract).not.toBeNull();
    expect(mode).not.toBeNull();
    expect(retries).not.toBeNull();

    change(contract!, "threat_report");
    change(mode!, "native");
    change(retries!, "2");

    const updated = useSimulatorStore.getState().nodes[0].config.executorAssurance;
    expect(updated).toMatchObject({
      enabled: true,
      contractId: "threat_report",
      contractVersion: "2.0.0",
      outputMode: "native",
      validationRetries: 2,
    });
    expect(container.textContent).toContain("Pydantic enforced");
    expect(container.textContent).toContain("severity");
    expect(container.textContent).toContain("generated JSON Schema");
  });

  it("opens and configures bound Gate and Evidence inspectors without portal recursion", () => {
    const gate: SimNode = {
      id: "gate",
      type: "typed_handoff_gate",
      config: {
        label: "Typed Handoff",
        typedHandoffGate: {
          contractId: "ioc_handoff",
          contractVersion: "1.0.0",
          validationMethod: "validate_python",
          strict: true,
          rejectBehavior: "route",
        },
      },
      position: { x: 0, y: 0 },
    };
    const evidence: SimNode = {
      id: "evidence",
      type: "evidence_check",
      config: {
        label: "Evidence",
        evidenceCheck: {
          checkIds: ["ioc_source_traceability"],
          aggregation: "all",
          checkWeights: {},
          failureBehavior: "route",
        },
      },
      position: { x: 100, y: 0 },
    };
    setNodes([gate, evidence]);
    act(() => root.render(<InspectorPanel />));

    act(() => useSimulatorStore.getState().selectNode("gate"));
    expect(container.textContent).toContain("Pydantic TypeAdapter");
    change(
      container.querySelector<HTMLSelectElement>('[aria-label="Handoff validation method"]')!,
      "validate_json",
    );
    change(
      container.querySelector<HTMLSelectElement>('[aria-label="Handoff rejection behavior"]')!,
      "stop",
    );

    act(() => useSimulatorStore.getState().selectNode("evidence"));
    expect(container.textContent).toContain("Independent Evidence Check");
    change(
      container.querySelector<HTMLSelectElement>('[aria-label="Evidence aggregation"]')!,
      "weighted",
    );
    change(
      container.querySelector<HTMLSelectElement>('[aria-label="Evidence failure behavior"]')!,
      "stop",
    );
    expect(container.querySelector('[aria-label="Weight for ioc_source_traceability"]')).not.toBeNull();
    expect(useSimulatorStore.getState().nodes[1].config.evidenceCheck).toMatchObject({
      aggregation: "weighted",
      failureBehavior: "stop",
      checkWeights: { ioc_source_traceability: "1" },
    });
  });

  it("configures Knowledge Retrieval and explains which metrics are actually measured", () => {
    const knowledge: SimNode = {
      id: "knowledge",
      type: "tool_rag",
      config: {
        label: "Knowledge Retrieval",
        assuranceOperationId: "retrieve_intel_knowledge",
        assuranceOperationVersion: "1.0.0",
        retrievalMode: "hybrid",
        kValue: 3,
      },
      position: { x: 0, y: 0 },
    };
    setNodes([knowledge]);
    act(() => root.render(<InspectorPanel />));
    act(() => useSimulatorStore.getState().selectNode("knowledge"));

    expect(container.textContent).toContain("Frozen corpus · deterministic one-run fixture");
    expect(container.textContent).toContain("Context precision");
    expect(container.textContent).toContain("Context recall");
    expect(container.textContent).toContain("Context relevance");
    expect(container.textContent).toContain("Not at retrieval stage");

    change(
      container.querySelector<HTMLSelectElement>('[aria-label="Knowledge retrieval strategy"]')!,
      "bm25",
    );
    change(
      container.querySelector<HTMLInputElement>('[aria-label="Knowledge retrieval top k"]')!,
      "4",
    );
    expect(useSimulatorStore.getState().nodes[0].config).toMatchObject({
      retrievalMode: "bm25",
      kValue: 4,
    });
  });
});
