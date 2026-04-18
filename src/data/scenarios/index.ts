import { bloatedSwarm } from "./bloated-swarm";
import type { Scenario } from "@/types/simulator";

// Architect scenarios (blank canvas)
const triageNurse: Scenario = {
  id: "triage-nurse",
  title: "The Triage Nurse",
  brief: "Build a medical intake system that classifies urgency and routes to specialists.",
  description: "Design an agent system that takes patient symptom descriptions, classifies urgency (emergency, urgent, routine), and routes to the appropriate specialist workflow. Must include quality checks on medical advice.",
  mode: "architect",
  expectedInputs: "Patient symptom descriptions in natural language",
  expectedOutputs: "Urgency classification + appropriate specialist response + safety disclaimers",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "web_search", "context_gate"],
  hints: [
    "Start with a Router to classify urgency level.",
    "Emergency cases need the most capable model. Routine cases can use a lighter one.",
    "An Evaluator after each specialist can catch dangerous medical advice.",
  ],
  maxCost: 12.0,
  maxLatency: 8.0,
  minReliability: 90,
  llmThresholds: { minPromptScore: 60, minArchitectureScore: 60 },
  editorial: {
    explanation: "A Router classifies urgency, then routes to specialized Executors. An Evaluator checks all responses for safety. Context gates ensure patient data is properly scoped.",
    commonMistakes: [
      { mistake: "No safety evaluator", whyItFails: "Medical advice without quality checks is dangerous and unreliable" },
      { mistake: "Same model for all urgency levels", whyItFails: "Wastes money on routine cases or under-serves emergencies" },
    ],
    optimalCode: [
      "# Triage: Router -> Specialist Executors -> Safety Evaluator",
      "graph = StateGraph()",
      "graph.add_node('triage', urgency_classifier)",
      "graph.add_node('emergency', emergency_handler)",
      "graph.add_node('routine', routine_handler)",
      "graph.add_node('safety_check', safety_evaluator)",
    ].join("\n"),
    keyConcepts: [
      "Safety-critical systems need evaluator nodes",
      "Route by urgency to match model capability to need",
      "Context gates protect sensitive patient data",
    ],
  },
};

const tradingFloor: Scenario = {
  id: "trading-floor",
  title: "The Trading Floor",
  brief: "Build a multi-source financial analysis pipeline with parallel data gathering.",
  description: "Design an agent that gathers financial data from multiple sources in parallel (web search, file data, RAG), synthesizes insights, and produces a trading recommendation. Latency is critical - the data must be gathered simultaneously.",
  mode: "architect",
  expectedInputs: "Stock ticker symbol and analysis request",
  expectedOutputs: "Trading recommendation with supporting data from multiple sources",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "web_search", "file_rw", "tool_rag", "context_gate"],
  hints: [
    "Parallel branches reduce latency - can you gather data simultaneously?",
    "A Router can split the request into parallel data-gathering tasks.",
    "Use a Context Gate before the synthesis step to manage the large context from multiple sources.",
  ],
  maxCost: 15.0,
  maxLatency: 10.0,
  minReliability: 85,
  llmThresholds: { minPromptScore: 55, minArchitectureScore: 55 },
  editorial: {
    explanation: "Use a Router to fork into parallel data-gathering branches (web, files, RAG), then a Context Gate to filter/summarize before a synthesis Executor produces the recommendation.",
    commonMistakes: [
      { mistake: "Sequential data gathering", whyItFails: "Latency adds up - 3 sequential sources = 3x the wait time" },
      { mistake: "No context management before synthesis", whyItFails: "Dumping all raw data into one prompt exceeds context limits" },
    ],
    optimalCode: [
      "# Parallel data gathering -> Context Gate -> Synthesis",
      "graph = StateGraph()",
      "graph.add_node('splitter', split_request)",
      "graph.add_node('web_data', web_search)",
      "graph.add_node('file_data', file_reader)",
      "graph.add_node('rag_data', rag_lookup)",
      "graph.add_node('context_gate', filter_context)",
      "graph.add_node('synthesizer', produce_recommendation)",
    ].join("\n"),
    keyConcepts: [
      "Parallel branches for independent data sources",
      "Context gates to manage large merged contexts",
      "Model selection: heavy model for synthesis, light for routing",
    ],
  },
};

const contentMachine: Scenario = {
  id: "content-machine",
  title: "The Content Machine",
  brief: "Build a content generation pipeline with iterative refinement.",
  description: "Design a system that generates marketing content, evaluates it against brand guidelines, and iterates until quality thresholds are met. The system should handle blog posts, social media, and email campaigns.",
  mode: "architect",
  expectedInputs: "Content brief with target audience, tone, and format requirements",
  expectedOutputs: "Polished marketing content that meets brand guidelines",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "context_gate"],
  hints: [
    "An Evaluator creates a feedback loop for iterative improvement.",
    "Different content types (blog vs tweet) need different prompts.",
    "A Router can dispatch based on content format requested.",
  ],
  maxCost: 10.0,
  maxLatency: 15.0,
  minReliability: 88,
  llmThresholds: { minPromptScore: 60, minArchitectureScore: 55 },
  editorial: {
    explanation: "Route by content type, generate with a capable model, evaluate against criteria, loop back if quality is insufficient. Context gate between iterations prevents prompt bloat.",
    commonMistakes: [
      { mistake: "No feedback loop", whyItFails: "First-draft content rarely meets brand guidelines" },
      { mistake: "No context gate in the loop", whyItFails: "Each iteration adds to context, eventually degrading quality" },
    ],
    optimalCode: [
      "# Content generation with evaluation loop",
      "graph = StateGraph()",
      "graph.add_node('router', classify_content_type)",
      "graph.add_node('generator', generate_content)",
      "graph.add_node('evaluator', check_brand_guidelines)",
      "graph.add_node('context_gate', reset_for_revision)",
    ].join("\n"),
    keyConcepts: [
      "Evaluation loops for iterative refinement",
      "Context gates prevent prompt bloat in loops",
      "Evaluator criteria must be concrete and measurable",
    ],
  },
};

const safetyNet: Scenario = {
  id: "safety-net",
  title: "The Safety Net",
  brief: "Build a document processing system that handles file read failures gracefully.",
  description: "Design a system that processes documents from files, but the file system is unreliable (30% failure rate). Your architecture must handle failures gracefully using fallback routing, ensuring the pipeline doesn't crash on bad data.",
  mode: "architect",
  expectedInputs: "Document processing request with file references",
  expectedOutputs: "Processed document summary or graceful fallback response",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "file_rw", "fallback_router", "context_gate"],
  failureSequence: {
    nodeType: "file_rw",
    pattern: [true, false, true],
    failureMessage: "File returned corrupted/partial data",
  },
  hints: [
    "The Fallback Router node is designed exactly for this scenario.",
    "Place the Fallback Router after the File R/W node to catch failures.",
    "The success path processes normally; the failure path should provide a graceful degradation.",
  ],
  maxCost: 8.0,
  maxLatency: 8.0,
  minReliability: 80,
  llmThresholds: { minPromptScore: 50, minArchitectureScore: 55 },
  editorial: {
    explanation: "Place a Fallback Router after File R/W. Success handle goes to normal processing. Failure handle goes to a fallback Executor that acknowledges the issue and provides partial results.",
    commonMistakes: [
      { mistake: "No fallback routing", whyItFails: "Pipeline crashes on file failure, 0% reliability for failed calls" },
      { mistake: "Retrying without fallback", whyItFails: "Retries alone don't help if the file is consistently corrupted" },
    ],
    optimalCode: [
      "# File processing with fallback routing",
      "graph = StateGraph()",
      "graph.add_node('file_reader', read_file)",
      "graph.add_node('fallback_check', check_success)",
      "graph.add_node('processor', process_doc)",
      "graph.add_node('fallback', graceful_degradation)",
    ].join("\n"),
    keyConcepts: [
      "Fallback routing for unreliable tools",
      "Graceful degradation over hard failures",
      "Success/failure branching patterns",
    ],
  },
};

const goldPlater: Scenario = {
  id: "gold-plater",
  title: "The Gold Plater",
  brief: "Fix an over-engineered pipeline that uses premium models for trivial tasks.",
  description: "This pipeline uses o1-preview for everything including simple text formatting and classification. Fix the model assignments to match task complexity while maintaining output quality.",
  mode: "fixer",
  expectedInputs: "Mixed complexity tasks: classification, formatting, analysis, creative writing",
  expectedOutputs: "Same quality outputs at much lower cost",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "context_gate"],
  initialNodes: [
    { id: "input-1", type: "input", config: { label: "Task Input" }, position: { x: 50, y: 250 }, locked: true },
    { id: "exec-1", type: "executor", config: { label: "Classifier", model: "o1-preview", systemPrompt: "" }, position: { x: 250, y: 250 } },
    { id: "exec-2", type: "executor", config: { label: "Formatter", model: "o1-preview", systemPrompt: "" }, position: { x: 450, y: 150 } },
    { id: "exec-3", type: "executor", config: { label: "Analyzer", model: "o1-preview", systemPrompt: "" }, position: { x: 450, y: 350 } },
    { id: "eval-1", type: "evaluator", config: { label: "Quality Check", model: "o1-preview", evaluationPrompt: "", passFailCriteria: "" }, position: { x: 650, y: 250 } },
    { id: "output-1", type: "output", config: { label: "Result" }, position: { x: 850, y: 250 }, locked: true },
  ],
  initialEdges: [
    { id: "e1", source: "input-1", target: "exec-1" },
    { id: "e2", source: "exec-1", target: "exec-2" },
    { id: "e3", source: "exec-1", target: "exec-3" },
    { id: "e4", source: "exec-2", target: "eval-1" },
    { id: "e5", source: "exec-3", target: "eval-1" },
    { id: "e6", source: "eval-1", target: "output-1" },
  ],
  hints: [
    "Classification and formatting are simple tasks - do they need the most expensive model?",
    "Only complex analysis truly benefits from deep reasoning models.",
    "The evaluator also doesn't need o1-preview for basic quality checks.",
  ],
  maxCost: 6.0,
  maxLatency: 8.0,
  minReliability: 88,
  llmThresholds: { minPromptScore: 50, minArchitectureScore: 55 },
  editorial: {
    explanation: "Swap classification and formatting to lightweight models (GPT-4o Mini or Haiku). Keep the analyzer on a medium model. Downgrade the evaluator to a medium model.",
    commonMistakes: [
      { mistake: "Keeping o1-preview on all nodes", whyItFails: "Extreme cost with no quality benefit for simple tasks" },
      { mistake: "Downgrading everything to the cheapest model", whyItFails: "Analysis quality suffers with tiny models" },
    ],
    optimalCode: [
      "# Right-sized models per task",
      "classifier = Executor(model='gpt-4o-mini')  # Simple task",
      "formatter = Executor(model='gpt-4o-mini')   # Simple task",
      "analyzer = Executor(model='gpt-4o')         # Needs reasoning",
      "evaluator = Evaluator(model='claude-sonnet') # Medium suffices",
    ].join("\n"),
    keyConcepts: [
      "Model-task fit is the #1 cost optimization lever",
      "Premium models are for premium tasks only",
      "Evaluators rarely need the most expensive model",
    ],
  },
};

const fullStackAgent: Scenario = {
  id: "full-stack-agent",
  title: "The Full Stack Agent",
  brief: "Design a research assistant that searches, retrieves, analyzes, and summarizes.",
  description: "Build a comprehensive research agent that takes a research question, gathers information from web search and knowledge bases, analyzes findings, and produces a structured research report. Must manage context carefully across stages.",
  mode: "architect",
  expectedInputs: "Research question or topic with scope requirements",
  expectedOutputs: "Structured research report with citations and analysis",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "web_search", "tool_rag", "context_gate"],
  hints: [
    "Parallel information gathering (web + RAG) reduces latency.",
    "A Context Gate between gathering and analysis prevents context overload.",
    "An Evaluator can check the report meets the research scope requirements.",
  ],
  maxCost: 15.0,
  maxLatency: 12.0,
  minReliability: 85,
  llmThresholds: { minPromptScore: 55, minArchitectureScore: 55 },
  editorial: {
    explanation: "Fork into parallel web search + RAG retrieval, gate context, synthesize with a capable model, evaluate the report quality, loop if needed.",
    commonMistakes: [
      { mistake: "Sequential search then RAG", whyItFails: "Doubles the latency unnecessarily" },
      { mistake: "No context gate before synthesis", whyItFails: "Raw search + RAG results overflow the synthesis prompt" },
    ],
    optimalCode: [
      "# Research pipeline",
      "graph = StateGraph()",
      "graph.add_node('planner', plan_research)",
      "graph.add_node('web', web_search)",
      "graph.add_node('rag', knowledge_lookup)",
      "graph.add_node('gate', filter_relevant)",
      "graph.add_node('writer', write_report)",
      "graph.add_node('reviewer', review_quality)",
    ].join("\n"),
    keyConcepts: [
      "Parallel data gathering for independent sources",
      "Context management is critical for multi-stage pipelines",
      "Evaluation loops ensure output quality",
    ],
  },
};

export const ALL_SCENARIOS: Scenario[] = [
  bloatedSwarm,
  goldPlater,
  triageNurse,
  tradingFloor,
  contentMachine,
  safetyNet,
  fullStackAgent,
];

export function getScenarioById(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
