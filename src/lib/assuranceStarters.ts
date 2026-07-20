import type { AssuranceCapabilities, AssuranceOperationCapability } from "@/types/assurance";
import type { NodeConfig, SimEdge, SimNode } from "@/types/simulator";

export type AssuranceStarterProfile = "baseline" | "assured";

interface StarterDefinition {
  inputOperation: string;
  retrievalOperation?: string;
  producerOperation?: string;
  consumerOperation: string;
  outputOperation: string;
  handoffContract?: string;
  outputContract: string;
  checkIds: string[];
  title: string;
  lesson: string;
}

export interface AssuranceStarterPair {
  baseline: { nodes: SimNode[]; edges: SimEdge[] };
  assured: { nodes: SimNode[]; edges: SimEdge[] };
  title: string;
  lesson: string;
  mechanisms: string[];
}

const DEFINITIONS: Record<string, StarterDefinition> = {
  "threat-analyst": {
    inputOperation: "ingest_indicators",
    retrievalOperation: "retrieve_intel_knowledge",
    producerOperation: "enrich_ioc",
    consumerOperation: "write_brief",
    outputOperation: "emit_threat_brief",
    handoffContract: "ioc_handoff",
    outputContract: "threat_report",
    checkIds: ["ioc_source_traceability", "citation_grounding"],
    title: "Stop typed false positives before publication",
    lesson: "Pydantic AI constrains enrichment and report payloads; the handoff gate catches post-agent drift; grounding checks decide whether a structurally valid threat claim is actually supported.",
  },
  "bloated-swarm": {
    inputOperation: "ingest_support_query",
    consumerOperation: "answer_support_query",
    outputOperation: "emit_support_response",
    outputContract: "delegated_task_result",
    checkIds: ["tool_authorization", "handoff_integrity"],
    title: "Constrain delegation without pretending schemas prove authorization",
    lesson: "Pydantic AI returns a strict delegated result, while independent checks catch unauthorized tool use and handoff decay that remain schema-valid.",
  },
  "content-machine": {
    inputOperation: "ingest_content_brief",
    producerOperation: "generate_content",
    consumerOperation: "revise_content",
    outputOperation: "emit_content",
    handoffContract: "content_handoff",
    outputContract: "publishable_content",
    checkIds: ["citation_grounding", "brand_policy"],
    title: "Separate publishable structure from grounded content",
    lesson: "The draft and publication contracts are enforced in-agent, the TypeAdapter protects the revision boundary, and independent checks can reject invented citations or brand-policy violations.",
  },
  "due-diligence-engine": {
    inputOperation: "ingest_deal_brief",
    retrievalOperation: "research_company",
    producerOperation: "plan_research",
    consumerOperation: "write_memo",
    outputOperation: "emit_memo",
    handoffContract: "finding_handoff",
    outputContract: "diligence_report",
    checkIds: ["claim_evidence_link", "source_coverage"],
    title: "Keep investment conclusions linked to evidence",
    lesson: "Typed research findings and memo output prevent malformed handoffs, while evidence-link and coverage checks catch unsupported conclusions that a valid schema cannot detect.",
  },
  "gold-plater": {
    inputOperation: "ingest_task",
    producerOperation: "classify_task",
    consumerOperation: "format_result",
    outputOperation: "emit_implementation_result",
    handoffContract: "scope_handoff",
    outputContract: "implementation_result",
    checkIds: ["authorization_scope", "requirement_coverage"],
    title: "Enforce scope before rewarding polished output",
    lesson: "The scope handoff and final result are typed, but independent authorization and coverage checks decide whether the agent did the requested work rather than extra work.",
  },
  "mcp-migration": {
    inputOperation: "ingest_data_request",
    producerOperation: "process_data",
    consumerOperation: "process_comms",
    outputOperation: "emit_migration_result",
    handoffContract: "tool_result",
    outputContract: "migration_report",
    checkIds: ["tool_schema_match", "catalog_budget"],
    title: "Validate tool results and measure catalog discipline",
    lesson: "Pydantic AI constrains tool-result and migration-report shapes; the TypeAdapter protects the domain handoff; catalog and schema checks expose MCP bloat independently.",
  },
  "ops-center": {
    inputOperation: "ingest_incident",
    retrievalOperation: "lookup_runbook",
    producerOperation: "ack_missing_logs",
    consumerOperation: "write_critical_report",
    outputOperation: "emit_incident_report",
    handoffContract: "incident_handoff",
    outputContract: "incident_action",
    checkIds: ["policy_compliance", "approval_required"],
    title: "Keep typed incident actions behind policy evidence",
    lesson: "Pydantic AI makes incident handoffs and actions explicit, while policy and approval checks catch structurally valid but operationally unsafe remediation.",
  },
  "safety-net": {
    inputOperation: "ingest_document_request",
    producerOperation: "process_document",
    consumerOperation: "write_fallback",
    outputOperation: "emit_document_result",
    handoffContract: "safety_handoff",
    outputContract: "safety_decision",
    checkIds: ["required_fields_present", "escalation_policy"],
    title: "Contain corrupt inputs at a typed boundary",
    lesson: "The document handoff and fallback decision are typed; the boundary rejects corrupt payloads; required-field and escalation checks verify the safety policy rather than just the JSON shape.",
  },
};

function operation(
  capabilities: AssuranceCapabilities,
  nodeType: SimNode["type"],
  operationId: string,
): AssuranceOperationCapability {
  const match = capabilities.operations.find(
    (item) => item.node_type === nodeType && item.operation_id === operationId,
  );
  if (!match) throw new Error(`Scenario ${capabilities.scenario_id} does not advertise ${nodeType}:${operationId}.`);
  return match;
}

function contractVersion(
  capabilities: AssuranceCapabilities,
  operationCapability: AssuranceOperationCapability,
  contractId: string,
  kind: "handoff" | "output",
): string {
  const allowance = operationCapability.allowed_executor_contracts?.find(
    (item) => item.contract_id === contractId,
  );
  if (!allowance) {
    throw new Error(`Operation ${operationCapability.operation_id} cannot produce ${contractId}.`);
  }
  const contracts = kind === "handoff" ? capabilities.handoff_contracts : capabilities.output_contracts;
  const match = contracts.find(
    (item) => item.contract_id === contractId && item.contract_version === allowance.contract_version,
  );
  if (!match) throw new Error(`Scenario ${capabilities.scenario_id} does not advertise ${kind} contract ${contractId}.`);
  return match.contract_version;
}

function boundConfig(item: AssuranceOperationCapability, label: string): NodeConfig {
  return {
    ...(item.default_config ?? {}),
    label,
    assuranceOperationId: item.operation_id,
    assuranceOperationVersion: item.operation_version,
  };
}

function executorConfig(
  item: AssuranceOperationCapability,
  label: string,
  contractId: string,
  contractVersionValue: string,
  enabled: boolean,
): NodeConfig {
  const allowance = item.allowed_executor_contracts?.find(
    (candidate) => candidate.contract_id === contractId && candidate.contract_version === contractVersionValue,
  );
  if (!allowance) throw new Error(`Operation ${item.operation_id} cannot produce ${contractId}@${contractVersionValue}.`);
  return {
    ...boundConfig(item, label),
    ...(enabled ? {
      executorAssurance: {
        enabled: true,
        contractId,
        contractVersion: contractVersionValue,
        strict: true,
        outputMode: allowance.supported_output_modes.includes("tool")
          ? "tool"
          : allowance.supported_output_modes[0],
        validationRetries: 1,
      },
    } : {}),
  };
}

function graphForProfile(
  capabilities: AssuranceCapabilities,
  definition: StarterDefinition,
  profile: AssuranceStarterProfile,
): { nodes: SimNode[]; edges: SimEdge[] } {
  const assured = profile === "assured";
  const inputOperation = operation(capabilities, "input", definition.inputOperation);
  const consumerOperation = operation(capabilities, "executor", definition.consumerOperation);
  const outputOperation = operation(capabilities, "output", definition.outputOperation);
  const retrievalOperation = definition.retrievalOperation
    ? operation(capabilities, "tool_rag", definition.retrievalOperation)
    : null;
  const retrievalOffset = retrievalOperation ? 170 : 0;
  const outputVersion = contractVersion(capabilities, consumerOperation, definition.outputContract, "output");
  const checks = definition.checkIds.map((checkId) => {
    const check = capabilities.evidence_checks.find((item) => item.check_id === checkId);
    if (!check) throw new Error(`Scenario ${capabilities.scenario_id} does not advertise check ${checkId}.`);
    return check.check_id;
  });

  const input: SimNode = {
    id: "assurance-input",
    type: "input",
    config: boundConfig(inputOperation, "Scenario input"),
    position: { x: 40, y: 260 },
    locked: true,
  };
  const consumer: SimNode = {
    id: "assurance-consumer",
    type: "executor",
    config: executorConfig(
      consumerOperation,
      definition.producerOperation ? "Typed decision" : "Typed response",
      definition.outputContract,
      outputVersion,
      assured,
    ),
    position: { x: (definition.producerOperation ? 710 : 360) + retrievalOffset, y: 260 },
  };
  const output: SimNode = {
    id: "assurance-output",
    type: "output",
    config: boundConfig(outputOperation, "Persisted result"),
    position: { x: (definition.producerOperation ? 1190 : 1030) + retrievalOffset, y: 260 },
    locked: true,
  };
  const retrieval: SimNode | null = retrievalOperation ? {
    id: "assurance-retrieval",
    type: "tool_rag",
    config: {
      ...boundConfig(retrievalOperation, "Knowledge retrieval"),
      kValue: 3,
      retrievalMode: "hybrid",
    },
    position: { x: 220, y: 260 },
  } : null;

  if (!definition.producerOperation || !definition.handoffContract) {
    const nodes: SimNode[] = [input, ...(retrieval ? [retrieval] : []), consumer];
    const edges: SimEdge[] = retrieval ? [{
      id: "assurance-edge-input-retrieval",
      source: input.id,
      target: retrieval.id,
      sourceHandle: "out",
      targetHandle: "in",
      kind: "normal",
    }, {
      id: "assurance-edge-retrieval-consumer",
      source: retrieval.id,
      target: consumer.id,
      sourceHandle: "success",
      targetHandle: "in",
      kind: "normal",
    }] : [{
      id: "assurance-edge-input-consumer",
      source: input.id,
      target: consumer.id,
      sourceHandle: "out",
      targetHandle: "in",
      kind: "normal",
    }];
    if (assured) {
      nodes.push({
        id: "assurance-evidence",
        type: "evidence_check",
        config: {
          label: "Independent evidence",
          evidenceCheck: {
            checkIds: checks,
            aggregation: "all",
            checkWeights: {},
            failureBehavior: "stop",
          },
        },
        position: { x: 700 + retrievalOffset, y: 260 },
      });
      edges.push({
        id: "assurance-edge-consumer-evidence",
        source: consumer.id,
        target: "assurance-evidence",
        sourceHandle: "success",
        targetHandle: "in",
        kind: "normal",
      }, {
        id: "assurance-edge-evidence-output",
        source: "assurance-evidence",
        target: output.id,
        sourceHandle: "pass",
        targetHandle: "in",
        kind: "normal",
      });
    } else {
      edges.push({
        id: "assurance-edge-consumer-output",
        source: consumer.id,
        target: output.id,
        sourceHandle: "success",
        targetHandle: "in",
        kind: "normal",
      });
    }
    nodes.push(output);
    return { nodes, edges };
  }

  const producerOperation = operation(capabilities, "executor", definition.producerOperation);
  const handoffVersion = contractVersion(
    capabilities,
    producerOperation,
    definition.handoffContract,
    "handoff",
  );
  const producer: SimNode = {
    id: "assurance-producer",
    type: "executor",
    config: executorConfig(
      producerOperation,
      "Typed handoff producer",
      definition.handoffContract,
      handoffVersion,
      assured,
    ),
    position: { x: 260 + retrievalOffset, y: 260 },
  };
  const nodes: SimNode[] = [input, ...(retrieval ? [retrieval] : []), producer];
  const edges: SimEdge[] = retrieval ? [{
    id: "assurance-edge-input-retrieval",
    source: input.id,
    target: retrieval.id,
    sourceHandle: "out",
    targetHandle: "in",
    kind: "normal",
  }, {
    id: "assurance-edge-retrieval-producer",
    source: retrieval.id,
    target: producer.id,
    sourceHandle: "success",
    targetHandle: "in",
    kind: "normal",
  }] : [{
    id: "assurance-edge-input-producer",
    source: input.id,
    target: producer.id,
    sourceHandle: "out",
    targetHandle: "in",
    kind: "normal",
  }];

  if (assured) {
    nodes.push({
      id: "assurance-handoff-gate",
      type: "typed_handoff_gate",
      config: {
        label: "Typed trust boundary",
        typedHandoffGate: {
          contractId: definition.handoffContract,
          contractVersion: handoffVersion,
          validationMethod: "validate_python",
          strict: true,
          rejectBehavior: "stop",
        },
      },
      position: { x: 485 + retrievalOffset, y: 260 },
    });
    edges.push({
      id: "assurance-edge-producer-gate",
      source: producer.id,
      target: "assurance-handoff-gate",
      sourceHandle: "success",
      targetHandle: "in",
      kind: "normal",
    }, {
      id: "assurance-edge-gate-consumer",
      source: "assurance-handoff-gate",
      target: consumer.id,
      sourceHandle: "pass",
      targetHandle: "in",
      kind: "normal",
    });
  } else {
    edges.push({
      id: "assurance-edge-producer-consumer",
      source: producer.id,
      target: consumer.id,
      sourceHandle: "success",
      targetHandle: "in",
      kind: "normal",
    });
  }

  nodes.push(consumer);
  if (assured) {
    nodes.push({
      id: "assurance-evidence",
      type: "evidence_check",
      config: {
        label: "Independent evidence",
        evidenceCheck: {
          checkIds: checks,
          aggregation: "all",
          checkWeights: {},
          failureBehavior: "stop",
        },
      },
      position: { x: 950 + retrievalOffset, y: 260 },
    });
    edges.push({
      id: "assurance-edge-consumer-evidence",
      source: consumer.id,
      target: "assurance-evidence",
      sourceHandle: "success",
      targetHandle: "in",
      kind: "normal",
    }, {
      id: "assurance-edge-evidence-output",
      source: "assurance-evidence",
      target: output.id,
      sourceHandle: "pass",
      targetHandle: "in",
      kind: "normal",
    });
  } else {
    edges.push({
      id: "assurance-edge-consumer-output",
      source: consumer.id,
      target: output.id,
      sourceHandle: "success",
      targetHandle: "in",
      kind: "normal",
    });
  }
  nodes.push(output);
  return { nodes, edges };
}

export function buildAssuranceStarterPair(
  scenarioId: string,
  capabilities: AssuranceCapabilities,
): AssuranceStarterPair | null {
  const definition = DEFINITIONS[scenarioId];
  if (!definition || capabilities.scenario_id !== scenarioId || !capabilities.supported) return null;
  const baseline = graphForProfile(capabilities, definition, "baseline");
  const assured = graphForProfile(capabilities, definition, "assured");
  return {
    baseline,
    assured,
    title: definition.title,
    lesson: definition.lesson,
    mechanisms: [
      ...(definition.retrievalOperation ? ["Deterministic knowledge retrieval"] : []),
      "Pydantic AI output contracts",
      ...(definition.handoffContract ? ["Pydantic TypeAdapter handoff"] : []),
      "Independent evidence checks",
      "External Pydantic Evals",
    ],
  };
}

export function assuranceStarterDefinitionIds(): string[] {
  return Object.keys(DEFINITIONS);
}
