import type { Scenario } from "@/types/simulator";

export const mcpMigration: Scenario = {
  id: "mcp-migration",
  title: "The MCP Migration",
  brief: "Refactor a bloated tool executor into organized MCP servers.",
  description:
    "You've inherited a data processing agent where a single Executor has 12 tools attached directly — web search, file ops, RAG, code execution, and API calls all crammed into one context window. The result: massive context pollution, tool selection confusion, and terrible reliability. Your job: extract tools into organized MCP servers by domain, add proper routing, and eliminate context bloat. The key insight: MCP servers replace sprawling tool lists but each adds a coordination hop — organize by domain, not by tool.",
  mode: "fixer",
  difficulty: "medium",
  expectedInputs: "Data processing requests: research queries, document analysis, code generation, API integrations",
  expectedOutputs: "Clean, organized tool execution with proper domain routing and reduced context pollution",
  availableNodeTypes: [
    "input", "output", "executor", "evaluator", "router",
    "mcp_server", "web_search", "file_rw", "tool_rag", "code_exec", "api_call",
    "context_gate",
  ],
  initialNodes: [
    { id: "input-1", type: "input", config: { label: "Data Request" }, position: { x: 50, y: 300 }, locked: true },
    {
      id: "exec-bloated", type: "executor",
      config: {
        label: "Swiss Army Agent",
        model: "claude-opus",
        systemPrompt: "",
        tools: [
          "web_search_news", "web_search_academic", "web_search_social",
          "file_read", "file_write", "file_parse_pdf",
          "rag_knowledge_base", "rag_documentation",
          "code_python", "code_sql",
          "api_slack", "api_email",
        ],
      },
      position: { x: 400, y: 300 },
    },
    { id: "output-1", type: "output", config: { label: "Result" }, position: { x: 750, y: 300 }, locked: true },
  ],
  initialEdges: [
    { id: "e1", source: "input-1", target: "exec-bloated" },
    { id: "e2", source: "exec-bloated", target: "output-1" },
  ],
  hints: [
    "12 tools in one executor means the model spends half its context on tool descriptions instead of the actual task.",
    "Group tools by domain: research tools (search, RAG), data tools (files, code), and communication tools (APIs).",
    "An MCP Server bundles tools behind one coordination point — it replaces 3-4 individual tools with organized access.",
    "You still need a router to decide WHICH MCP server handles each request — don't just chain them all sequentially.",
    "The original agent uses claude-opus because it needed a huge context window for 12 tools. With MCP servers, a smaller model suffices.",
  ],
  maxCost: 8.0,
  maxLatency: 10.0,
  minReliability: 88,
  llmThresholds: { minPromptScore: 50, minArchitectureScore: 55 },
  editorial: {
    explanation:
      "Extract tools into 3 MCP servers by domain: Research MCP (web_search, tool_rag), Data MCP (file_rw, code_exec), and Comms MCP (api_call). Add a lightweight Router to classify the request and route to the appropriate MCP server. Each MCP server feeds a focused Executor with no direct tools — just clean MCP output. The Executor can now use a much cheaper model because its context isn't polluted with 12 tool definitions.",
    commonMistakes: [
      { mistake: "Creating one MCP server with all 12 tools", whyItFails: "You've just moved the problem — the MCP server now has the same context bloat" },
      { mistake: "Keeping claude-opus after tool extraction", whyItFails: "With clean MCP routing, a medium model handles each domain perfectly" },
      { mistake: "Chaining all MCP servers sequentially", whyItFails: "Most requests only need one domain. Sequential chaining wastes latency and cost on irrelevant tools" },
      { mistake: "Creating one MCP server per tool", whyItFails: "Each MCP adds coordination overhead. Group by domain, not by individual tool" },
    ],
    optimalCode: [
      "# MCP Migration: Route → Domain MCP → Focused Executor",
      "graph = StateGraph()",
      "",
      "# Classification",
      "graph.add_node('router', classify_request_domain)",
      "",
      "# Domain MCP servers",
      "graph.add_node('research_mcp', MCP(tools=[web_search, rag]))",
      "graph.add_node('data_mcp', MCP(tools=[file_rw, code_exec]))",
      "graph.add_node('comms_mcp', MCP(tools=[api_call]))",
      "",
      "# Focused executors (no direct tools!)",
      "graph.add_node('research_agent', Executor(model='gpt-4o'))",
      "graph.add_node('data_agent', Executor(model='gpt-4o'))",
      "graph.add_node('comms_agent', Executor(model='gpt-4o-mini'))",
    ].join("\n"),
    keyConcepts: [
      "Tools are a resource you manage, not a list you append to",
      "MCP servers organize tools by domain — group by function, not by tool type",
      "Tool extraction enables model downgrades — smaller context = cheaper models",
      "Route to the right domain, don't chain through all domains",
    ],
  },
};
