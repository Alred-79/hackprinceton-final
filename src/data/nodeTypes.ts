import type { SimNodeType } from "@/types/simulator";

export interface NodeTypeMeta {
  type: SimNodeType;
  label: string;
  description: string;
  category: "io" | "brain" | "tool" | "control";
  color: string;       // tailwind bg class token
  icon: string;        // lucide icon name
  hasModel: boolean;
  hasPrompt: boolean;
  maxInputs: number;
  maxOutputs: number;
  defaultConfig: Record<string, unknown>;
}

export const NODE_TYPE_META: Record<SimNodeType, NodeTypeMeta> = {
  input: {
    type: "input",
    label: "Input",
    description: "Entry point for user queries",
    category: "io",
    color: "node-input",
    icon: "LogIn",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 0,
    maxOutputs: 10,
    defaultConfig: { label: "Input" },
  },
  output: {
    type: "output",
    label: "Output",
    description: "Final response to the user",
    category: "io",
    color: "node-output",
    icon: "LogOut",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 10,
    maxOutputs: 0,
    defaultConfig: { label: "Output" },
  },
  executor: {
    type: "executor",
    label: "Executor",
    description: "LLM brain that processes and generates text",
    category: "brain",
    color: "node-executor",
    icon: "Brain",
    hasModel: true,
    hasPrompt: true,
    maxInputs: 10,
    maxOutputs: 10,
    defaultConfig: { label: "Executor", model: "gpt-4o", systemPrompt: "", tools: [] },
  },
  evaluator: {
    type: "evaluator",
    label: "Evaluator",
    description: "Judges output quality with pass/fail criteria",
    category: "brain",
    color: "node-evaluator",
    icon: "CheckCircle",
    hasModel: true,
    hasPrompt: true,
    maxInputs: 10,
    maxOutputs: 2,
    defaultConfig: { label: "Evaluator", model: "gpt-4o", evaluationPrompt: "", passFailCriteria: "" },
  },
  router: {
    type: "router",
    label: "Router",
    description: "Directs flow based on LLM classification",
    category: "control",
    color: "node-router",
    icon: "GitBranch",
    hasModel: true,
    hasPrompt: true,
    maxInputs: 10,
    maxOutputs: 10,
    defaultConfig: { label: "Router", model: "gpt-4o-mini", routingPrompt: "", routes: ["Route A", "Route B"] },
  },
  web_search: {
    type: "web_search",
    label: "Web Search",
    description: "Retrieves information from the web",
    category: "tool",
    color: "node-tool",
    icon: "Globe",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Web Search" },
  },
  file_rw: {
    type: "file_rw",
    label: "File R/W",
    description: "Reads and writes files/documents",
    category: "tool",
    color: "node-tool",
    icon: "FileText",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "File R/W" },
  },
  context_gate: {
    type: "context_gate",
    label: "Context Gate",
    description: "Manages context between agent stages",
    category: "control",
    color: "node-context",
    icon: "Filter",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Context Gate" },
  },
  tool_rag: {
    type: "tool_rag",
    label: "Tool RAG",
    description: "Retrieval-Augmented Generation from knowledge base",
    category: "tool",
    color: "node-tool",
    icon: "Database",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Tool RAG", kValue: 5 },
  },
  fallback_router: {
    type: "fallback_router",
    label: "Fallback Router",
    description: "Routes to fallback on tool failure",
    category: "control",
    color: "node-fallback",
    icon: "Shield",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 2,
    defaultConfig: { label: "Fallback Router" },
  },
  code_exec: {
    type: "code_exec",
    label: "Code Exec",
    description: "Executes generated code (Python, SQL, calculations)",
    category: "tool",
    color: "node-tool",
    icon: "Terminal",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Code Exec" },
  },
  api_call: {
    type: "api_call",
    label: "API Call",
    description: "Makes structured API calls to external services",
    category: "tool",
    color: "node-tool",
    icon: "Webhook",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "API Call", endpoint: "" },
  },
  human_review: {
    type: "human_review",
    label: "Human Review",
    description: "Pauses pipeline for human approval or editing",
    category: "control",
    color: "node-human",
    icon: "UserCheck",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Human Review", reviewType: "approval" },
  },
  mcp_server: {
    type: "mcp_server",
    label: "MCP Server",
    description: "Tool aggregator that bundles multiple tools behind one coordination point",
    category: "tool",
    color: "node-mcp",
    icon: "Server",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "MCP Server", servedTools: [] },
  },
  kafka_stream: {
    type: "kafka_stream",
    label: "Kafka Stream",
    description: "Publishes events to a Kafka topic or message bus for async downstream processing",
    category: "tool",
    color: "node-stream",
    icon: "Radio",
    hasModel: false,
    hasPrompt: false,
    maxInputs: 5,
    maxOutputs: 5,
    defaultConfig: { label: "Kafka Stream" },
  },
};

// Connection validation rules
export function canConnect(sourceType: SimNodeType, targetType: SimNodeType): boolean {
  // Input can connect to anything except itself
  if (sourceType === "input" && targetType === "input") return false;
  // Nothing can connect to input
  if (targetType === "input") return false;
  // Output can't connect to anything
  if (sourceType === "output") return false;
  // Everything else is allowed
  return true;
}
