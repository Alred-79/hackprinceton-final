import { describe, expect, it } from "vitest";
import { buildAssuranceStarterPair, assuranceStarterDefinitionIds } from "@/lib/assuranceStarters";
import { semanticGraphIdentity, serializeSimulatorGraph } from "@/lib/assuranceGraph";
import type { AssuranceCapabilities, AssuranceOperationCapability } from "@/types/assurance";

const matrix = {
  "threat-analyst": ["ingest_indicators", "enrich_ioc", "write_brief", "emit_threat_brief", "ioc_handoff", "threat_report", "ioc_source_traceability", "citation_grounding"],
  "bloated-swarm": ["ingest_support_query", null, "answer_support_query", "emit_support_response", null, "delegated_task_result", "tool_authorization", "handoff_integrity"],
  "content-machine": ["ingest_content_brief", "generate_content", "revise_content", "emit_content", "content_handoff", "publishable_content", "citation_grounding", "brand_policy"],
  "due-diligence-engine": ["ingest_deal_brief", "plan_research", "write_memo", "emit_memo", "finding_handoff", "diligence_report", "claim_evidence_link", "source_coverage"],
  "gold-plater": ["ingest_task", "classify_task", "format_result", "emit_implementation_result", "scope_handoff", "implementation_result", "authorization_scope", "requirement_coverage"],
  "mcp-migration": ["ingest_data_request", "process_data", "process_comms", "emit_migration_result", "tool_result", "migration_report", "tool_schema_match", "catalog_budget"],
  "ops-center": ["ingest_incident", "ack_missing_logs", "write_critical_report", "emit_incident_report", "incident_handoff", "incident_action", "policy_compliance", "approval_required"],
  "safety-net": ["ingest_document_request", "process_document", "write_fallback", "emit_document_result", "safety_handoff", "safety_decision", "required_fields_present", "escalation_policy"],
} as const;

const retrievalByScenario = {
  "threat-analyst": "retrieve_intel_knowledge",
  "due-diligence-engine": "research_company",
  "ops-center": "lookup_runbook",
} as const;

function operation(
  nodeType: AssuranceOperationCapability["node_type"],
  operationId: string,
  contractId?: string,
): AssuranceOperationCapability {
  return {
    operation_id: operationId,
    operation_version: "1.0.0",
    node_type: nodeType,
    label: operationId,
    default_config: nodeType === "executor"
      ? { model: "reagent-fixture-v1", tools: [] }
      : nodeType === "tool_rag"
        ? { kValue: 5, retrievalMode: "hybrid" }
        : {},
    ports: [
      ...(nodeType === "input" ? [] : [{ id: "in", direction: "input" as const }]),
      ...(nodeType === "output" ? [] : nodeType === "input"
        ? [{ id: "out", direction: "output" as const }]
        : [{ id: "success", direction: "output" as const }, { id: "failure", direction: "output" as const }]),
    ],
    allowed_executor_contracts: contractId ? [{
      contract_id: contractId,
      contract_version: "1.0.0",
      supported_output_modes: ["tool", "native", "prompted"],
    }] : [],
  };
}

function capabilitiesFor(scenarioId: keyof typeof matrix): AssuranceCapabilities {
  const [input, producer, consumer, output, handoff, terminal, ...checks] = matrix[scenarioId];
  const retrieval = scenarioId in retrievalByScenario
    ? retrievalByScenario[scenarioId as keyof typeof retrievalByScenario]
    : null;
  return {
    enabled: true,
    supported: true,
    scenario_id: scenarioId,
    operations: [
      operation("input", input),
      ...(retrieval ? [operation("tool_rag", retrieval)] : []),
      ...(producer && handoff ? [operation("executor", producer, handoff)] : []),
      operation("executor", consumer, terminal),
      operation("output", output),
    ],
    output_contracts: [{ contract_id: terminal, contract_version: "1.0.0", label: terminal }],
    handoff_contracts: handoff ? [{ contract_id: handoff, contract_version: "1.0.0", label: handoff }] : [],
    evidence_checks: checks.map((checkId) => ({ check_id: checkId, check_version: "1.0.0", label: checkId })),
    eval_suites: [{ suite_id: `${scenarioId}-assurance`, suite_version: "1.0.0" }],
  };
}

describe("scenario assurance starters", () => {
  it("ships a starter definition for every current scenario", () => {
    expect(assuranceStarterDefinitionIds().sort()).toEqual(Object.keys(matrix).sort());
  });

  it("binds the operation-approved contract version when replay versions share an ID", () => {
    const capabilities = capabilitiesFor("threat-analyst");
    capabilities.output_contracts = [
      { contract_id: "threat_report", contract_version: "1.0.0", label: "Threat Report v1" },
      { contract_id: "threat_report", contract_version: "2.0.0", label: "Threat Report v2" },
    ];
    const writer = capabilities.operations.find((item) => item.operation_id === "write_brief");
    writer!.allowed_executor_contracts = [{
      contract_id: "threat_report",
      contract_version: "2.0.0",
      supported_output_modes: ["tool"],
    }];

    const starter = buildAssuranceStarterPair("threat-analyst", capabilities)!;
    const consumer = starter.assured.nodes.find((item) => item.id === "assurance-consumer");
    expect(consumer?.config.executorAssurance?.contractVersion).toBe("2.0.0");
  });

  for (const scenarioId of Object.keys(matrix) as Array<keyof typeof matrix>) {
    it(`${scenarioId} provides a causal executable baseline and assured profile`, () => {
      const capabilities = capabilitiesFor(scenarioId);
      const starter = buildAssuranceStarterPair(scenarioId, capabilities);
      expect(starter).not.toBeNull();
      const { baseline, assured } = starter!;

      expect(baseline.nodes.some((node) => node.type === "evidence_check")).toBe(false);
      expect(baseline.nodes.some((node) => node.type === "typed_handoff_gate")).toBe(false);
      expect(baseline.nodes.filter((node) => node.type === "executor").every((node) => !node.config.executorAssurance)).toBe(true);

      expect(assured.nodes.some((node) => node.type === "evidence_check")).toBe(true);
      expect(assured.nodes.some((node) => node.type === "typed_handoff_gate")).toBe(Boolean(matrix[scenarioId][4]));
      expect(assured.nodes.filter((node) => node.type === "executor").every((node) =>
        node.config.executorAssurance?.enabled && node.config.executorAssurance.validationRetries === 1
      )).toBe(true);

      const expectedRetrieval = scenarioId in retrievalByScenario;
      expect(baseline.nodes.some((node) => node.type === "tool_rag")).toBe(expectedRetrieval);
      expect(assured.nodes.some((node) => node.type === "tool_rag")).toBe(expectedRetrieval);
      if (expectedRetrieval) {
        const retrieval = assured.nodes.find((node) => node.type === "tool_rag");
        expect(retrieval?.config).toMatchObject({ kValue: 3, retrievalMode: "hybrid" });
      }

      const baselineOperations = baseline.nodes
        .map((node) => node.config.assuranceOperationId)
        .filter(Boolean)
        .sort();
      const assuredOperations = assured.nodes
        .map((node) => node.config.assuranceOperationId)
        .filter(Boolean)
        .sort();
      expect(assuredOperations).toEqual(baselineOperations);

      for (const edge of [...baseline.edges, ...assured.edges]) {
        expect(edge.sourceHandle).toBeTruthy();
        expect(edge.targetHandle).toBeTruthy();
      }
      expect(() => serializeSimulatorGraph(baseline.nodes, baseline.edges)).not.toThrow();
      expect(() => serializeSimulatorGraph(assured.nodes, assured.edges)).not.toThrow();
      expect(semanticGraphIdentity(baseline.nodes, baseline.edges, capabilities))
        .not.toEqual(semanticGraphIdentity(assured.nodes, assured.edges, capabilities));
    });
  }
});
