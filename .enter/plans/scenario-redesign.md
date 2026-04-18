# New Node Types + Scenario Enhancements

## Context
The simulator currently has 10 node types (3 brain, 3 tool, 2 control, 2 IO). The tool category is thin — Web Search, File R/W, and Tool RAG are all passive data fetchers. Real agent architectures use active tools (code execution, API calls, database queries) and coordination patterns (human-in-the-loop, MCP servers). Adding these would make scenarios more realistic and teach new design principles.

## New Node Types (4 additions)

### 1. `code_exec` — Code Interpreter (Tool)
- **What it does**: Executes generated code (Python, SQL, calculations)
- **Why it matters**: Most real agent systems generate code — it's the highest-leverage tool but also the highest-risk. Teaches: sandboxing decisions, when to use code vs LLM reasoning
- **Config**: None (passive tool, like web_search)
- **Cost**: $0.15 (compute), **Latency**: 1.5s, **Reliability penalty**: -3% if not behind a fallback router (code can error)
- **Icon**: `Terminal` (lucide)

### 2. `api_call` — API Tool (Tool)
- **What it does**: Makes structured API calls (REST endpoints, webhooks, external services)
- **Why it matters**: Distinct from web_search (browsing). API calls are structured, authenticated, and can fail with specific error codes. Teaches: tool-specific error handling, structured input/output
- **Config**: `endpoint` label (cosmetic — e.g. "Stripe API", "Slack Webhook")
- **Cost**: $0.08, **Latency**: 0.8s
- **Icon**: `Webhook` (lucide)

### 3. `human_review` — Human-in-the-Loop (Control)
- **What it does**: Pauses the pipeline for human approval/review
- **Why it matters**: Critical real-world pattern. Not everything should be automated. Teaches: when to insert human checkpoints (high-stakes decisions, compliance), cost of human latency vs automation risk
- **Config**: `reviewType` ("approval" | "edit" | "escalation")
- **Cost**: $0 (free), **Latency**: 30s (simulated human wait), **Reliability**: +15% bonus when placed before high-stakes output
- **Icon**: `UserCheck` (lucide)

### 4. `mcp_server` — MCP Server (Tool)
- **What it does**: A "tool aggregator" that bundles multiple tool capabilities behind a single coordination point. In the simulator, it replaces 2-3 individual tool nodes with one server that serves them all.
- **Why it matters**: Teaches MCP pattern — instead of giving an executor 15 tools directly, route through an MCP server that manages tool selection. Reduces context pollution. But adds a coordination hop (latency cost).
- **Config**: `servedTools` (checkboxes: which tool types this MCP serves — web_search, file_rw, tool_rag, code_exec, api_call)
- **Cost**: $0.30 (coordination overhead), **Latency**: 0.5s (added hop) + underlying tool latencies
- **Icon**: `Server` (lucide)
- **Grading**: MCP server that serves 3+ tools gets +5% reliability bonus (cleaner tool management). MCP serving 1 tool gets -3% (unnecessary overhead).

## Scenario Changes

### Modify: "The Bloated Swarm" (easy, fixer)
**No change needed.** Pure consolidation lesson — new tools don't apply here.

### Modify: "The Gold Plater" (easy, fixer)
**No change needed.** Pure model-sizing lesson.

### Modify: "The Content Machine" (medium, architect)
**Add**: `api_call` to available nodes.
**Why**: Content pipeline should publish to CMS/social platforms via API calls. This is realistic and teaches: API calls at the end of a pipeline (write-back pattern), not just data-fetching at the start.
**Updated hints**: Add hint about using API Tool for publishing after quality check passes.

### Modify: "The Safety Net" (medium, architect)  
**Add**: `code_exec` to available nodes + make it part of the failure scenario.
**Why**: Document processing often involves code (parsing PDFs, extracting tables). Code execution can fail just like file reads. Teaches: multiple failure points need multiple fallback routers (or one MCP server).
**Updated failureSequence**: Both `file_rw` AND `code_exec` can fail. The answer should handle both.

### Modify: "The Ops Center" (hard, architect)
**Add**: `code_exec`, `human_review` to available nodes.
**Why**: 
- Critical incidents need human approval before executing mitigation (you don't auto-remediate P1s without human sign-off)
- Log analysis often involves code (parsing, aggregation)
- Teaches: human-in-the-loop placement (after triage, before remediation action, NOT before diagnosis)
**Updated answer**: Add human_review after Critical Response, before output. Routine path skips human review (auto-resolved).

### Modify: "The Due Diligence Engine" (hard, architect)
**Add**: `api_call`, `mcp_server`, `human_review` to available nodes.
**Why**:
- Financial data comes from APIs (Bloomberg, SEC EDGAR) not web search
- Legal + financial + market data tools are a perfect MCP server candidate (3 tools → 1 server)  
- Investment decisions require human sign-off before the memo is finalized
- Teaches: MCP consolidation, human-in-the-loop for high-stakes decisions, API vs web search distinction
**Updated answer**: Replace 3 parallel tool nodes with 1 MCP server. Add human_review before final output.

### New Scenario: "The MCP Migration" (medium, fixer)
**Concept**: The student inherits an executor with 12 tools attached directly (massive context pollution). They need to refactor by:
1. Extracting tools into MCP servers by domain (data tools, action tools, comms tools)
2. Routing through the right MCP server
3. Reducing the executor's direct tool count from 12 to 0

**Teaches**: 
- P5 (new): "Tools are a resource you manage, not a list you append to"
- MCP as a tool organization pattern
- Context pollution from excessive tool lists

**Available nodes**: input, output, executor, router, mcp_server, web_search, file_rw, tool_rag, code_exec, api_call, context_gate
**Initial state**: 1 executor with `tools: [12 items]`, wired Input → Executor → Output. Expensive, slow, unreliable.
**Goal**: Refactor to use MCP servers with routing. Dramatically lower cost and higher reliability.

## Grading Engine Updates

### New cost/latency rules:
- `code_exec`: cost $0.15, latency 1.5s
- `api_call`: cost $0.08, latency 0.8s
- `human_review`: cost $0, latency 30s (massive latency — intentional trade-off)
- `mcp_server`: cost $0.30 + sum of served tool costs, latency 0.5s + max served tool latency

### New reliability rules:
- `human_review` before high-stakes output: +15% bonus
- `human_review` before routine output: -5% penalty (unnecessary bottleneck)
- `mcp_server` serving 3+ tools: +5% bonus
- `mcp_server` serving 1 tool: -3% penalty (overhead without benefit)
- `code_exec` without fallback_router (when in failureSequence): -10% penalty

### Human review placement detection:
- "High-stakes" = human_review connects (directly or via 1 hop) to output AND the path includes a router with "Critical"/"Urgent" route OR an evaluator fail path
- "Routine" = human_review on every path regardless of classification

## Files to Modify

1. **`src/types/simulator.ts`** — Add 4 new node types to `SimNodeType` union, add `servedTools`, `endpoint`, `reviewType` to `NodeConfig`
2. **`src/data/nodeTypes.ts`** — Add 4 new `NODE_TYPE_META` entries
3. **`src/engine/GradingEngine.ts`** — Add cost/latency/reliability rules for new nodes
4. **`src/components/nodes/SimulatorNode.tsx`** — Add icons, colors for new types; MCP server shows served tool badges
5. **`src/components/simulator/InspectorPanel.tsx`** — Add config UI for MCP (tool checkboxes), API (endpoint label), Human Review (type selector)
6. **`src/data/scenarios/index.ts`** — Update 4 existing scenarios, add "MCP Migration" scenario
7. **`src/data/scenarios/mcp-migration.ts`** — New scenario file
8. **`src/data/answers.ts`** — Update 4 answers, add MCP Migration answer
9. **`src/components/simulator/NodePalette.tsx`** — No changes needed (auto-picks up from NODE_TYPE_META)
10. **`src/index.css`** — Add colors for new node categories (human = warm amber, mcp = indigo)

## Verification
- All 7 scenarios load without error
- All 7 answers stay within their budget constraints
- New nodes appear in palette when scenario includes them
- MCP server config UI shows tool checkboxes
- Human review shows type selector
- Grading engine properly scores MCP bonus/penalty and human review placement
- Context Thermometer reflects MCP tool consolidation (MCP's served tools count toward tool total)
