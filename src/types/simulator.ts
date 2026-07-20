// ============================================================
// LangGraph Agent Architecture Simulator — Core Types
// ============================================================

// --- Node Types ---
export type SimNodeType =
  | "input"
  | "output"
  | "executor"
  | "evaluator"
  | "router"
  | "web_search"
  | "file_rw"
  | "context_gate"
  | "tool_rag"
  | "fallback_router"
  | "code_exec"
  | "api_call"
  | "human_review"
  | "mcp_server"
  | "kafka_stream"
  | "typed_handoff_gate"
  | "evidence_check";

export type ContextGateMode = "pass_through" | "structured_sendoff" | "full_reset" | "compact";
export type HumanReviewType = "approval" | "edit" | "escalation";
export type ServedToolType = "web_search" | "file_rw" | "tool_rag" | "code_exec" | "api_call";
export type KnowledgeRetrievalMode = "bm25" | "vector" | "hybrid";

export interface ExecutorAssuranceConfig {
  enabled: boolean;
  contractId: string;
  contractVersion: string;
  strict: boolean;
  outputMode: "tool" | "native" | "prompted";
  validationRetries: number;
}

export interface TypedHandoffGateAssuranceConfig {
  contractId: string;
  contractVersion: string;
  validationMethod: "validate_python" | "validate_json";
  strict: boolean;
  rejectBehavior: "route" | "stop" | "request_revision";
}

export interface EvidenceCheckAssuranceConfig {
  checkIds: string[];
  aggregation: "all" | "any" | "weighted";
  checkWeights: Record<string, string>;
  passingScore?: string;
  failureBehavior: "route" | "stop";
}

export interface NodeConfig {
  label: string;
  model?: string;
  systemPrompt?: string;
  evaluationPrompt?: string;
  passFailCriteria?: string;
  routingPrompt?: string;
  routes?: string[];
  /** @deprecated Imported legacy metadata; executable graphs use executorAssurance. */
  outputSchema?: string;
  contextGateMode?: ContextGateMode;
  handoffBrief?: string;
  kValue?: number;
  retrievalMode?: KnowledgeRetrievalMode;
  tools?: string[];
  endpoint?: string;
  validatorId?: string;
  reviewType?: HumanReviewType;
  servedTools?: ServedToolType[];
  assuranceOperationId?: string;
  assuranceOperationVersion?: string;
  executorAssurance?: ExecutorAssuranceConfig;
  typedHandoffGate?: TypedHandoffGateAssuranceConfig;
  evidenceCheck?: EvidenceCheckAssuranceConfig;
}

export interface SimNode {
  id: string;
  type: SimNodeType;
  config: NodeConfig;
  position: { x: number; y: number };
  locked?: boolean;
}

export interface SimEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  kind?: "normal" | "conditional" | "failure" | "retry";
  fanOut?: "all" | "exclusive";
  routeProbability?: string;
  maxAttempts?: number;
}

// --- Model Definitions ---
export interface ModelDef {
  id: string;
  name: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  assumedLatencySeconds: number;
  profileAsOf: string;
  profileSource: "legacy_default_assumption";
  tier: "small" | "medium" | "large" | "xl";
  capabilities: string[];
}

// --- Scenario ---
export type ScenarioMode = "fixer" | "architect";

export interface FailureSequence {
  nodeType: string;
  pattern: boolean[];
  failureMessage: string;
}

export type ScenarioDifficulty = "easy" | "medium" | "hard";

export interface Scenario {
  id: string;
  title: string;
  brief: string;
  description: string;
  mode: ScenarioMode;
  difficulty?: ScenarioDifficulty;
  expectedInputs: string;
  expectedOutputs: string;
  availableNodeTypes: SimNodeType[];
  initialNodes?: SimNode[];
  initialEdges?: SimEdge[];
  hints: string[];
  maxCost: number;
  maxLatency: number;
  minReliability: number;
  llmThresholds: {
    minPromptScore: number;
    minArchitectureScore: number;
  };
  failureSequence?: FailureSequence;
  optimalNodes?: SimNode[];
  optimalEdges?: SimEdge[];
  editorial?: {
    explanation: string;
    commonMistakes: Array<{ mistake: string; whyItFails: string }>;
    optimalCode: string;
    keyConcepts: string[];
  };
}

// --- Grading ---
export interface DeterministicResults {
  cost: number;
  latency: number;
  scenarioReadiness: number;
  metricLabels: {
    cost: "estimate";
    latency: "estimate";
    scenarioReadiness: "heuristic";
    taskPass: "not_measured";
  };
  intervals: {
    cost: { low: number; high: number };
    latency: { low: number; high: number };
  };
  assumptions: string[];
  bonuses: Array<{ label: string; value: number }>;
  penalties: Array<{ label: string; value: number }>;
  warnings: string[];
}

export interface LLMGradeResponse {
  overall: {
    pass: boolean;
    architectureScore: number;
    promptScore: number;
    feedback: string;
    suggestions: string[];
  };
  perNode: Array<{
    nodeId: string;
    promptScore: number;
    feedback: string;
    issues: string[];
  }>;
  contextManagement: {
    score: number;
    feedback: string;
    gateDecisions: Array<{
      gateNodeId: string;
      modeChosen: string;
      appropriate: boolean;
      reason: string;
    }>;
  };
  evaluatorQuality: {
    score: number;
    criteriaAssessments: Array<{
      evaluatorNodeId: string;
      criteriaQuality: "strong" | "adequate" | "weak" | "empty";
      feedback: string;
    }>;
  };
}

// --- Trace ---
export interface TraceStep {
  nodeId: string;
  nodeType: SimNodeType;
  label: string;
  input: string;
  output: string;
  cost: number;
  latency: number;
  success: boolean;
  loopIteration?: number;
  isParallel?: boolean;
}

// --- Progress ---
export type ProgressStatus = "not_started" | "attempted" | "passed" | "optimal";
export type ResultsTab = "analysis" | "execution" | "evals";

export interface ScenarioProgress {
  status: ProgressStatus;
  attempts: number;
  bestScenarioReadiness?: number;
  bestCost?: number;
  bestLatency?: number;
}

// --- Store ---
export interface SimulatorState {
  // Canvas state
  nodes: SimNode[];
  edges: SimEdge[];
  selectedNodeId: string | null;

  // Scenario
  currentScenario: Scenario | null;
  
  // Grading results
  deterministicResults: DeterministicResults | null;
  llmResults: LLMGradeResponse | null;
  isEvaluating: boolean;
  isLLMLoading: boolean;
  resultsStale: boolean;
  
  // Trace
  traceSteps: TraceStep[];
  activeTraceStep: number | null;
  
  // History
  history: Array<{ nodes: SimNode[]; edges: SimEdge[] }>;
  historyIndex: number;
  
  // Hints
  hintsRevealed: number;
  attempts: number;

  // Right panel tab
  activeRightTab: "inspector" | "results";
  activeResultsTab: ResultsTab;
}
