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
  | "event_stream";

export type ContextGateMode = "full_reset" | "structured_sendoff";
export type HumanReviewType = "approval" | "edit" | "escalation";
export type ServedToolType = "web_search" | "file_rw" | "tool_rag" | "code_exec" | "api_call";

export interface NodeConfig {
  label: string;
  model?: string;
  systemPrompt?: string;
  evaluationPrompt?: string;
  passFailCriteria?: string;
  routingPrompt?: string;
  routes?: string[];
  outputSchema?: string;
  contextGateMode?: ContextGateMode;
  handoffBrief?: string;
  kValue?: number;
  tools?: string[];
  endpoint?: string;
  reviewType?: HumanReviewType;
  servedTools?: ServedToolType[];
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
}

// --- Model Definitions ---
export interface ModelDef {
  id: string;
  name: string;
  costPer1kTokens: number;
  avgLatency: number; // seconds
  reliability: number; // 0-1
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
  reliability: number;
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

export interface ScenarioProgress {
  status: ProgressStatus;
  attempts: number;
  bestReliability?: number;
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
}
