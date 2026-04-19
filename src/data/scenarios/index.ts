import { bloatedSwarm } from "./bloated-swarm";
import { mcpMigration } from "./mcp-migration";
import { threatAnalyst } from "./threat-analyst";
import type { Scenario } from "@/types/simulator";

const goldPlater: Scenario = {
  id: "gold-plater",
  title: "The Gold Plater",
  brief: "Fix an over-engineered pipeline that uses premium models for trivial tasks.",
  description: "This pipeline uses o1-preview for everything including simple text formatting and classification. Fix the model assignments to match task complexity while maintaining output quality.",
  mode: "fixer",
  difficulty: "easy",
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
    "Classification and formatting are simple tasks — do they need the most expensive model?",
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

const contentMachine: Scenario = {
  id: "content-machine",
  title: "The Content Machine",
  brief: "Build a content generation pipeline with iterative refinement.",
  description: "Design a system that generates marketing content, evaluates it against brand guidelines, and iterates until quality thresholds are met. The system should handle blog posts, social media, and email campaigns. Context management in the eval loop is critical — without it, each iteration adds to context and degrades output quality.",
  mode: "architect",
  difficulty: "medium",
  expectedInputs: "Content brief with target audience, tone, and format requirements",
  expectedOutputs: "Polished marketing content that meets brand guidelines",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "context_gate", "api_call"],
  hints: [
    "An Evaluator creates a feedback loop for iterative improvement.",
    "Different content types (blog vs tweet) need different prompts — use a Router.",
    "Without a Context Gate in the loop, each iteration adds draft + feedback to context, eventually degrading quality.",
    "After content passes quality check, an API Call can publish directly to your CMS or social platform.",
  ],
  maxCost: 10.0,
  maxLatency: 15.0,
  minReliability: 88,
  llmThresholds: { minPromptScore: 60, minArchitectureScore: 55 },
  editorial: {
    explanation: "Route by content type, generate with a capable model, evaluate against criteria, loop back if quality is insufficient. A Context Gate between iterations prevents prompt bloat — strip the old draft, keep only the evaluator feedback and original brief.",
    commonMistakes: [
      { mistake: "No feedback loop", whyItFails: "First-draft content rarely meets brand guidelines" },
      { mistake: "No context gate in the loop", whyItFails: "Each iteration adds to context, eventually degrading quality — this is like never compacting a Claude Code session" },
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
      "Context gates prevent prompt bloat in loops — strip the draft, keep the feedback",
      "Evaluator criteria must be concrete and measurable",
    ],
  },
};

const safetyNet: Scenario = {
  id: "safety-net",
  title: "The Safety Net",
  brief: "Build a document processing system that handles file read failures gracefully.",
  description: "Design a system that processes documents from files, but the file system is unreliable (30% failure rate). Your architecture must handle failures at the tool level using fallback routing. The trap: adding an evaluator at the end can't distinguish 'agent reasoned poorly' from 'agent got bad input data.'",
  mode: "architect",
  difficulty: "medium",
  expectedInputs: "Document processing request with file references",
  expectedOutputs: "Processed document summary or graceful fallback response",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "file_rw", "fallback_router", "context_gate", "code_exec"],
  failureSequence: {
    nodeType: "file_rw",
    pattern: [true, false, true],
    failureMessage: "File returned corrupted/partial data",
  },
  hints: [
    "The Fallback Router node is designed exactly for this scenario.",
    "Place the Fallback Router right after the File R/W node to catch failures where they happen.",
    "An evaluator at the end can't tell if the output is bad because of bad reasoning or bad input data.",
  ],
  maxCost: 8.0,
  maxLatency: 8.0,
  minReliability: 80,
  llmThresholds: { minPromptScore: 50, minArchitectureScore: 55 },
  editorial: {
    explanation: "Place a Fallback Router after File R/W. Success handle goes to normal processing. Failure handle goes to a fallback Executor that acknowledges the issue and provides partial results. Error handling belongs at the tool level — detect failures before they propagate.",
    commonMistakes: [
      { mistake: "Evaluator at the end to catch bad output", whyItFails: "Can't distinguish 'agent reasoned poorly' from 'agent got corrupted input data'" },
      { mistake: "No fallback routing at all", whyItFails: "Pipeline crashes on file failure, 0% reliability for failed calls" },
    ],
    optimalCode: [
      "# Handle errors where they happen",
      "graph = StateGraph()",
      "graph.add_node('file_reader', read_file)",
      "graph.add_node('fallback_check', check_success)  # Right after the tool",
      "graph.add_node('processor', process_doc)           # Success path",
      "graph.add_node('fallback', graceful_degradation)   # Failure path",
    ].join("\n"),
    keyConcepts: [
      "Handle errors where they happen, not where they hurt",
      "Fallback routing at the tool level, not evaluation at the end",
      "Graceful degradation over hard failures",
    ],
  },
};

// ==========================================
// COMPOUND PRINCIPLE SCENARIOS
// ==========================================

const opsCenter: Scenario = {
  id: "ops-center",
  title: "The Ops Center",
  brief: "Build an IT incident response system: gather diagnostics, handle tool failures, triage, and produce structured reports.",
  description: "Design an IT operations center that handles incoming incidents. The system must gather diagnostic data from multiple sources in parallel (status pages, system logs, runbooks), but log retrieval is unreliable. After gathering and filtering the data, classify severity and produce a structured incident report. Key insight: you can't triage without intelligence — gather data first, then route.",
  mode: "architect",
  difficulty: "hard",
  expectedInputs: "Unstructured incident alert (monitoring alert, user report, or error log excerpt)",
  expectedOutputs: "Structured incident report with severity classification, affected systems, root cause analysis, and mitigation steps",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "web_search", "file_rw", "tool_rag", "context_gate", "fallback_router", "code_exec", "human_review"],
  failureSequence: {
    nodeType: "file_rw",
    pattern: [true, false, true],
    failureMessage: "System logs returned corrupted/partial data",
  },
  hints: [
    "Gather diagnostic data in parallel BEFORE classifying severity — you can't triage without intelligence.",
    "System logs are unreliable. Handle the failure at the tool level with a Fallback Router, not with an evaluator at the end.",
    "Raw diagnostic data is noisy (HTML, stack traces, duplicates). Use a Context Gate before the severity Router to filter it.",
    "Incident reports have strict structure. An output schema enforces format at zero cost — no evaluator needed for format checking.",
    "Critical incidents should require human approval before remediation — you don't auto-fix P1s without sign-off.",
  ],
  maxCost: 14.0,
  maxLatency: 45.0,
  minReliability: 82,
  llmThresholds: { minPromptScore: 55, minArchitectureScore: 60 },
  editorial: {
    explanation: "Fan out to 3 parallel diagnostic tools. Handle log failures with a Fallback Router right after File R/W. Merge all data through a Context Gate (structured sendoff) to filter the noise. THEN classify severity with a Router — you triage based on what you found, not the raw alert. Route to cost-appropriate response handlers that use output schemas to enforce incident report structure. Evaluator checks content quality (not format — that's structural).",
    commonMistakes: [
      { mistake: "Classifying severity from the raw alert before gathering data", whyItFails: "Without diagnostic context, severity classification is guesswork — 'disk full' could be routine or could mean production is down" },
      { mistake: "No fallback on log retrieval", whyItFails: "When logs fail, the entire pipeline crashes or produces garbage — handle errors where they happen" },
      { mistake: "Dumping raw diagnostics into the response writer", whyItFails: "Raw tool output is noisy (full HTML, stack traces, duplicate data). Without a Context Gate, the response writer gets polluted context" },
      { mistake: "Using an evaluator to check report format", whyItFails: "Output schemas enforce structure at zero cost and zero latency — structural guarantees beat runtime checks" },
    ],
    optimalCode: [
      "# Ops Center: Parallel diagnostics → Error handling → Context filter → Triage → Structured report",
      "graph = StateGraph()",
      "",
      "# Parallel diagnostic gathering",
      "graph.add_node('status_check', web_search_status_pages)",
      "graph.add_node('log_reader', read_system_logs)",
      "graph.add_node('runbook_lookup', rag_runbooks)",
      "",
      "# Error handling at the tool level",
      "graph.add_node('log_fallback_check', fallback_router)",
      "graph.add_node('log_fallback', acknowledge_missing_logs)",
      "",
      "# Context management + Triage",
      "graph.add_node('data_filter', context_gate_structured_sendoff)",
      "graph.add_node('severity_router', classify_severity)",
      "",
      "# Structured response (with output schema)",
      "graph.add_node('critical_response', write_incident_report_critical)",
      "graph.add_node('routine_response', write_incident_report_routine)",
    ].join("\n"),
    keyConcepts: [
      "Dispatch: gather intelligence first, THEN route — you can't triage without data",
      "Error handling: Fallback Router right after the unreliable tool, not an evaluator at the end",
      "Context management: filter noisy diagnostic data before it reaches downstream agents",
      "Structural guarantees: output schemas enforce report format at zero cost vs runtime evaluators",
    ],
  },
};

const dueDiligenceEngine: Scenario = {
  id: "due-diligence-engine",
  title: "The Due Diligence Engine",
  brief: "Build an M&A research pipeline: parallel research, unreliable legal docs, multi-stage context management, and iterative memo drafting.",
  description: "Design a due diligence system for mergers & acquisitions. Given a target company, plan research, gather data from multiple sources in parallel, handle unreliable legal document retrieval, filter research into a clean brief, and produce a structured investment memo — iterating with an evaluator until quality is sufficient. The critical skill: managing context across pipeline stages AND in the eval loop.",
  mode: "architect",
  difficulty: "hard",
  expectedInputs: "Target company name and acquisition context (deal size, strategic rationale, concerns)",
  expectedOutputs: "Structured investment memo with company overview, financials, risks, team assessment, and recommendation",
  availableNodeTypes: ["input", "output", "executor", "evaluator", "router", "web_search", "file_rw", "tool_rag", "context_gate", "fallback_router", "api_call", "mcp_server", "human_review"],
  failureSequence: {
    nodeType: "file_rw",
    pattern: [false, true, true, false],
    failureMessage: "Legal documents returned incomplete/corrupted data",
  },
  hints: [
    "Start with a planner that decomposes the question into research tasks before gathering data.",
    "Legal document retrieval is unreliable. Handle failures at the tool level — the gap noter should flag what's missing so the memo writer can caveat appropriately.",
    "Raw research data (full SEC filings, legal boilerplate) will overwhelm the memo writer. Use a Context Gate to extract only key findings.",
    "The eval loop needs its OWN Context Gate: strip the old draft, keep only evaluator feedback + original brief. This is the 'compact your session vs seed a fresh sub-agent' decision.",
    "Investment memos have strict structure. An output schema enforces it at zero cost.",
    "Consider using an MCP Server to consolidate your research tools — less context pollution.",
    "Investment decisions need human sign-off. Place Human Review before the final output.",
  ],
  maxCost: 16.0,
  maxLatency: 50.0,
  minReliability: 80,
  llmThresholds: { minPromptScore: 60, minArchitectureScore: 65 },
  editorial: {
    explanation: "Plan research first, then fan out to 3 parallel sources. Handle legal doc failures with a Fallback Router + Gap Noter (flags what's missing). Merge research through a Context Gate to extract key findings. Memo writer uses output schema for structure. Evaluator checks quality, and on failure, a SECOND Context Gate strips the old draft — keeping only feedback + original brief — before looping back. Two context gates, two different purposes: one filters raw data, one manages iteration hygiene.",
    commonMistakes: [
      { mistake: "No context gate before memo writing", whyItFails: "Full SEC filings + legal docs + market data = context overflow. The memo writer can't distinguish signal from noise" },
      { mistake: "Looping the full draft back through the evaluator", whyItFails: "Each iteration adds draft + feedback to context. By iteration 3, the prompt is enormous and quality degrades — this is the Claude Code session compaction problem" },
      { mistake: "Evaluator at the end to catch missing legal data", whyItFails: "The evaluator can't tell if bad coverage is because the agent reasoned poorly or because legal docs were corrupted. Handle the tool failure at the source" },
      { mistake: "No output schema on the memo writer", whyItFails: "Investment memos have strict structure. Without a schema, the model invents its own format every time. Structural guarantees beat runtime checks" },
    ],
    optimalCode: [
      "# Due Diligence: Plan → Parallel research → Error handling → Context filter → Draft → Evaluate → Loop",
      "graph = StateGraph()",
      "",
      "# Planning",
      "graph.add_node('planner', decompose_research_question)",
      "",
      "# Parallel research with error handling",
      "graph.add_node('market_search', web_search_financials)",
      "graph.add_node('legal_reader', read_legal_docs)",
      "graph.add_node('legal_fallback_check', fallback_router)",
      "graph.add_node('gap_noter', flag_missing_legal_data)",
      "graph.add_node('company_lookup', rag_company_data)",
      "",
      "# Context management (Gate #1: filter raw research)",
      "graph.add_node('research_filter', context_gate_structured_sendoff)",
      "",
      "# Structured memo + eval loop",
      "graph.add_node('memo_writer', write_memo_with_schema)",
      "graph.add_node('quality_check', evaluate_memo_quality)",
      "",
      "# Context management (Gate #2: loop hygiene)",
      "graph.add_node('revision_gate', context_gate_strip_draft_keep_feedback)",
    ].join("\n"),
    keyConcepts: [
      "Multi-stage context management: different gates serve different purposes (filtering vs loop hygiene)",
      "The eval loop context gate IS the 'compact session vs seed fresh sub-agent' decision",
      "Handle tool failures at the source — gap noter flags what's missing instead of end-evaluator guessing",
      "Structural guarantees: output schema enforces memo format at zero cost",
    ],
  },
};

export const ALL_SCENARIOS: Scenario[] = [
  bloatedSwarm,
  goldPlater,
  contentMachine,
  safetyNet,
  mcpMigration,
  opsCenter,
  dueDiligenceEngine,
  threatAnalyst,
];

export function getScenarioById(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
