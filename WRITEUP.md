# LangGraph Architecture Simulator -- Technical Writeup

## 1. Industry Context & Motivation

The AI engineering landscape in 2025-2026 has shifted from "can we get an LLM to do X?" to "how do we orchestrate multiple LLMs, tools, and control flows to do X reliably at scale?" Frameworks like LangGraph, CrewAI, AutoGen, and OpenAI's Swarm have emerged to address multi-agent orchestration, but the talent pipeline has a fundamental gap: there is no structured way to learn agent architecture design.

Traditional coding assessment platforms (LeetCode, HackerRank, CodeSignal) optimize for algorithmic problem-solving -- sorting, graph traversal, dynamic programming. These skills remain relevant but are insufficient for the dominant engineering challenge of the current era: designing systems where the "compute" is a $0.03-per-call API with variable latency, hallucination risk, and context window limits.

The cost of getting agent architecture wrong is concrete and measurable:
- A naive architecture that sends every request through GPT-4 Turbo instead of routing 70% of traffic to GPT-4o-mini can cost 10-15x more with negligible quality improvement.
- An evaluator-heavy architecture that adds three sequential LLM-as-judge calls adds $6+ and 9 seconds of latency per request.
- A system without context gates that pipes full conversation history through every node burns context window budget and degrades output quality as conversations grow.

The LangGraph Architecture Simulator was built to address this gap. It is an interactive, browser-based training platform where engineers learn to design, debug, and optimize multi-agent architectures by solving progressively harder scenarios with real cost, latency, and reliability constraints.

---

## 2. System Architecture

### 2.1 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend Framework | React 19 + TypeScript | Component architecture, type safety |
| Build Tool | Vite | Fast HMR, optimized bundling |
| Styling | Tailwind CSS + custom design tokens | Dark theme, semantic color system |
| State Management | Zustand | Lightweight global store with undo/redo history |
| Graph Canvas | @xyflow/react (React Flow v12) | Node/edge rendering, drag-and-drop, pan/zoom |
| Animation | Framer Motion + CSS animations | Context thermometer shake, node transitions |
| Backend | Supabase Edge Functions (Deno) | LLM-as-judge evaluation via Claude Sonnet 4.5 |
| AI Integration | Enter Cloud AI API | Proxied access to Claude for qualitative grading |

### 2.2 Application Structure

```
src/
  types/simulator.ts          -- Core type definitions (14 node types, configs, scenarios)
  data/
    models.ts                 -- 10 LLM model definitions with cost/latency/reliability stats
    nodeTypes.ts              -- Node type metadata, categories, connection rules
    scenarios/
      index.ts                -- 7 scenario definitions (easy/medium/hard)
      bloated-swarm.ts        -- Fixer scenario: pre-placed broken architecture
      mcp-migration.ts        -- Fixer scenario: tool sprawl needing MCP consolidation
    answers.ts                -- Verified optimal architectures for all scenarios
  engine/
    GradingEngine.ts          -- Deterministic scoring (cost, latency, reliability)
    graphUtils.ts             -- Graph algorithms (DFS cycles, BFS latency, topological sort)
  store/
    simulatorStore.ts         -- Zustand store: nodes, edges, history, evaluation state
  components/
    nodes/SimulatorNode.tsx   -- Custom React Flow node with 3D depth, glow, cost indicators
    edges/AnimatedEdge.tsx    -- Animated edge with flowing pulse dots
    simulator/
      Canvas.tsx              -- React Flow canvas with drag-and-drop from palette
      NodePalette.tsx         -- Categorized node selection sidebar
      InspectorPanel.tsx      -- Node configuration (model, prompts, routes, schemas)
      HUD.tsx                 -- Live metrics, score breakdown, hints, actions
      ContextThermometer.tsx  -- Visual context pressure indicator with extreme state
      ResultsPanel.tsx        -- Evaluation results display
      Editorial.tsx           -- Post-evaluation editorial explanation modal
  pages/
    ScenarioSelect.tsx        -- Scenario browser with difficulty badges
    Simulator.tsx             -- Main simulator layout (palette + canvas + inspector)
  lib/
    vibrate.ts                -- Haptic feedback patterns (tap, pulse, warning, error, success)
supabase/
  functions/
    grade-solution/index.ts   -- Edge Function: LLM-as-judge via Claude Sonnet 4.5
```

---

## 3. Node Type System

The simulator models 14 distinct node types organized into 5 categories. Each type has specific cost characteristics, latency profiles, and connection rules that mirror real-world agent architecture components.

### 3.1 Brain Nodes (LLM-powered)

**Executor** -- The workhorse node. Runs an LLM to perform a task described by a system prompt. Configurable model selection from 10 options ranging from GPT-4o-mini ($0.15/1k tokens, 0.5s latency) to o1-preview ($30/1k tokens, 15s latency). The core cost driver in any architecture.

**Evaluator** -- An LLM-as-judge that scores or validates another node's output. Mechanically identical to an Executor in cost but grants reliability bonuses with diminishing returns: first evaluator +25%, second +10%, third and beyond +2%. This teaches engineers that evaluation has real value but stacking evaluators is wasteful.

**Router** -- An LLM that classifies input and dispatches to different downstream paths. Configurable route labels (e.g., "critical", "routine", "spam"). Zero-cost tool nodes downstream of a router only execute on their branch, teaching the principle that routing eliminates unnecessary work.

### 3.2 Tool Nodes (External capabilities)

**Web Search** -- Simulates internet search. Fixed cost $0.10, latency 1.0s. No model selection needed.

**File R/W** -- Simulates file system read/write. Fixed cost $0.05, latency 0.3s. Listed in scenario `failureSequence` arrays to teach fallback placement.

**Tool RAG** -- Retrieval-augmented generation. Fixed cost $0.20, latency 0.8s. Configurable `kValue` (number of retrieved chunks) that affects both cost and quality.

**Code Exec** -- Code execution sandbox. Fixed cost $0.15, latency 1.5s. Represents sandboxed code interpreters (like OpenAI's Code Interpreter or E2B).

**API Call** -- Structured API endpoint call. Fixed cost $0.08, latency 0.8s. Configurable endpoint label. Distinct from web search: structured request/response vs. browsing.

### 3.3 Control Nodes

**Context Gate** -- Filters or summarizes context before passing downstream. Two modes: "full_reset" (wipes and restarts context) and "structured_sendoff" (compresses with key extraction). Fixed cost $0.02, latency 0.1s. Grants +5% reliability per gate. This teaches context-as-resource management.

**Fallback Router** -- Routes to an alternative path when a connected tool fails. Fixed cost $0.01, latency 0.05s. Grants +10% reliability bonus. Must be connected to a tool node. Teaches error-at-source handling.

### 3.4 Integration Nodes

**MCP Server** -- Model Context Protocol server that aggregates multiple tools behind a single coordination point. Fixed base cost $0.30, latency 1.2s. Configurable `servedTools` checklist. Grants +5% reliability when serving 3+ tools. Teaches the MCP pattern: consolidate tool sprawl into domain-organized servers.

**Human Review** -- Human-in-the-loop checkpoint. Fixed cost $0.00, latency 30.0s. Grants +15% reliability. The deliberate tradeoff: maximum reliability at the cost of latency. Teaches that 100% automation is not always the correct answer.

### 3.5 I/O Nodes

**Input** -- Entry point. Every architecture must have exactly one. Cost $0, latency 0s.

**Output** -- Exit point. Every architecture must have at least one. Cost $0, latency 0s.

---

## 4. Deterministic Grading Engine

The grading engine (`GradingEngine.ts`) performs real-time graph analysis to compute three scores: cost, latency, and reliability. It uses classical graph algorithms adapted for the specific semantics of agent architectures.

### 4.1 Cost Calculation

```
Total Cost = SUM over all nodes of:
  (model.costPer1kTokens * loopMultiplier) + fixedToolCost
```

- `loopMultiplier` = 3x for any node inside a cycle (detected via DFS)
- Tool nodes use fixed costs (web_search: $0.10, file_rw: $0.05, etc.)
- MCP servers add $0.30 base plus the costs of their served tools
- Human review nodes cost $0.00 (the human is the cost, not the API)

The loop multiplier is critical: it teaches engineers that putting an expensive model inside an eval-retry loop triples its effective cost, making model selection within loops a high-leverage optimization.

### 4.2 Latency Calculation

Uses **topological sort (Kahn's algorithm)** to find the longest critical path:

1. Build adjacency list and incoming edge map
2. Process nodes in topological order
3. For each node, compute `maxArrivalTime + nodeLatency`
4. Critical path = maximum arrival time at any Output node

Parallel branches (nodes with the same parent and same child) execute simultaneously -- only the slowest branch contributes to latency. This rewards architectures that fan out independent tool calls.

Human review nodes add 30s to the critical path, which forces engineers to route them off the critical path or accept the latency tradeoff for reliability.

### 4.3 Reliability Calculation

Reliability starts at a base of 50% and accumulates bonuses/penalties:

| Factor | Effect |
|--------|--------|
| First evaluator | +25% |
| Second evaluator | +10% |
| Third+ evaluator | +2% each |
| Context gate | +5% each |
| Fallback router | +10% each |
| Output schema (first) | +8% |
| Output schema (second) | +3% |
| Human review | +15% each |
| MCP server (3+ tools) | +5% each |
| Tool count > 5 | -3% per excess tool |
| Chained executors (no gate between) | -5% per chain of 3+ |
| Disconnected nodes | -10% each |

This scoring system encodes the four design principles:
- **P1 (Dispatch)**: Routers don't add reliability directly but reduce cost by eliminating unnecessary downstream calls
- **P2 (Context management)**: Context gates give +5% each, and chained executors without gates are penalized
- **P3 (Structural guarantees)**: Output schemas give +8%/+3% at zero node cost, while evaluators cost money for diminishing returns
- **P4 (Error at source)**: Fallback routers give +10% reliability, teaching that error handling belongs at the tool level

### 4.4 Graph Utilities

`graphUtils.ts` provides six pure functions:

- `getAdjacencyList(edges)` -- Builds directed adjacency map
- `getIncomingMap(edges)` -- Builds reverse adjacency map for Kahn's algorithm
- `detectCycles(nodes, edges)` -- DFS-based cycle detection returning all nodes in cycles
- `findParallelBranches(nodes, edges)` -- Identifies nodes that fan out from the same parent
- `topologicalSort(nodes, edges)` -- Kahn's algorithm for latency calculation
- `getDisconnectedNodes(nodes, edges)` -- Finds nodes with no incoming or outgoing edges
- `countChainedExecutorsWithoutGate(nodes, edges)` -- Traverses executor chains measuring context pressure

All functions include cycle protection via visited sets to prevent infinite recursion in architectures with eval-retry loops.

---

## 5. LLM-as-Judge (Qualitative Scoring)

The deterministic engine handles structural correctness, but architectural quality requires qualitative assessment. A Supabase Edge Function (`grade-solution/index.ts`) sends the student's architecture to Claude Sonnet 4.5 with a structured prompt:

**Input**: Scenario description, node graph (types, models, connections, configs), cost/latency/reliability scores from deterministic engine.

**Prompt structure**: The LLM is asked to evaluate along four axes:
1. Is the routing strategy appropriate for the scenario's dispatch requirements?
2. Are context gates placed at meaningful boundaries (not arbitrarily)?
3. Are structural guarantees (schemas, fallbacks) preferred over expensive runtime checks?
4. Is error handling co-located with failure points?

**Output**: JSON with `score` (0-100), `passed` (boolean), `feedback` (string), `suggestions` (string array).

**Dual-pass grading**: Both the deterministic score AND the LLM score must independently pass their thresholds for the overall grade to be PASS. This prevents gaming either system -- you can't pass with a structurally sound but architecturally nonsensical design, and you can't pass with clever reasoning but a graph that costs $50.

---

## 6. Scenario Design

### 6.1 Scenario Structure

Each scenario defines:
- `mode`: "fixer" (pre-placed broken architecture) or "architect" (blank canvas)
- `difficulty`: "easy", "medium", or "hard"
- `maxCost` / `maxLatency`: Budget constraints
- `maxNodes`: Node count limit
- `availableNodes`: Which node types the student can use
- `failureSequence`: Which tools are prone to failure (teaches fallback placement)
- `hints`: Progressive hint system
- `editorial`: Post-solve explanation

### 6.2 Scenario Progression

**Easy -- The Bloated Swarm (Fixer)**
7 claude-opus executors doing over-specialized tasks. Student must consolidate into 2-3 executors with cheaper models and add a router. Teaches: model selection matters, routing eliminates waste.

**Easy -- The Gold Plater (Fixer)**
Architecture drowning in evaluators (4 sequential LLM-as-judge calls). Student must reduce to 1-2 evaluators and add output schemas instead. Teaches: structural guarantees beat runtime checks.

**Medium -- Content Machine (Architect)**
Build a content pipeline (blog + email + social) from scratch. Requires routing by content type and parallel tool use. Budget: $10, latency: 8s. Available: all brain + tool nodes including API Call. Teaches: fan-out parallelism, model-per-task optimization.

**Medium -- Safety Net (Architect)**
Build a code generation pipeline with validation. Requires evaluator placement and fallback handling. Budget: $12, latency: 10s. Available: all types including Code Exec. Teaches: evaluator placement, error handling.

**Medium -- The MCP Migration (Fixer)**
12 scattered tools (search, file ops, APIs, code exec, RAG) connected to a single bloated executor. Student must refactor into 3 domain-organized MCP servers (Research, Operations, Analysis) with a router dispatching to the correct domain. Teaches: the MCP pattern, tool consolidation, domain routing.

**Hard -- Ops Center (Architect)**
Build an incident response system. Fan-out intelligence gathering (web search, file logs, RAG knowledge base), severity-based routing, human sign-off on critical incidents, output schemas on response handlers. Budget: $18, latency: 40s. Available: all 14 node types. Teaches: P1 (dispatch after intelligence), P2 (context gate before response), P3 (schemas on handlers), P4 (fallback on log retrieval), plus human-in-the-loop tradeoffs.

**Hard -- Due Diligence Engine (Architect)**
Build an investment analysis pipeline. Plan-gather-gate-draft-evaluate-revise loop. MCP server aggregating research tools, API calls for financial data, human partner sign-off before final output. Budget: $24, latency: 50s. Available: all 14 node types. Teaches: deep sequential architectures, revision loops, MCP aggregation, human review at the right point (after machine analysis, before distribution).

### 6.3 Answer Verification

Every scenario has a verified optimal solution in `answers.ts`. These are complete node + edge + config definitions that the student can load to study. Each answer was manually validated to:
- Stay within the scenario's cost and latency budgets
- Maximize reliability score given the constraints
- Demonstrate the design principles the scenario is meant to teach

---

## 7. Visual & Interaction Design

### 7.1 Node Visualization

Nodes are rendered with multiple visual channels encoding information:

- **3D Depth**: Perspective tilt (`rotateX`) and simulated side/bottom extrusion bars. Depth scales with model reliability -- high-reliability nodes (like evaluators) appear more elevated/prominent. Creates visual hierarchy where important architectural decisions literally "stand out."

- **Cost Glow**: Ambient glow color ranges from bright yellow (cheap/efficient) to bright red (expensive). Calculated as `costRatio = nodeCost / maxCostInGraph`. A small colored dot appears next to the model label. This lets engineers visually scan for cost hotspots without reading numbers.

- **Model-Proportional Scale**: Node `scale()` ranges from 0.88 (small models like gpt-4o-mini) to 1.32 (large models like o1-preview). More expensive models are physically larger on the canvas, making cost visible at the architectural level.

- **Category Colors**: Each node category has a distinct color: purple (brain), cyan (tool), amber (control), indigo (integration), slate (I/O). This enables instant pattern recognition of architectural composition.

- **Edit Affordance**: Configurable nodes show a gear icon on hover (top-right). Non-configurable nodes (Input, Output, Web Search, File R/W) have no edit button, preventing confusion.

### 7.2 Edge Animation

Edges render as animated SVG paths with two staggered pulse dots flowing from source to target. Each dot has a glow filter (`feGaussianBlur` + composite). The animation runs continuously at 3s period, creating a sense of "data flowing" through the architecture. Edge color matches the connection type (default: cyan-400).

### 7.3 Context Thermometer

A Framer Motion-animated component in the HUD that visualizes context pressure:

| State | Tool Count | Visual |
|-------|-----------|--------|
| Low | 0-10 | Green bar, steady |
| Moderate | 11-18 | Amber bar |
| High | 19-25 | Orange bar, subtle pulse |
| Extreme | 25+ | Red bar, shake animation, flame icon pulse, CSS steam particles |

The extreme state uses `framer-motion` shake animation (`x: [-3, 3, -3, 0]` at 0.15s repeat) and CSS `::before`/`::after` pseudo-elements generating animated steam particles that rise from the thermometer. This provides visceral feedback that the architecture is over-complicated.

### 7.4 Haptic Feedback

The `vibrate.ts` utility provides five patterns using the browser Vibration API:

| Pattern | Trigger | Duration |
|---------|---------|----------|
| `vibrateTap` | Node added, edge connected | 15ms single pulse |
| `vibratePulse` | Hint revealed, answer loaded | 30-50-30ms triple pulse |
| `vibrateWarning` | Budget exceeded before evaluation | 100-50-100ms heavy double |
| `vibrateError` | Evaluation failed | 200-100-200-100-200ms escalating |
| `vibrateSuccess` | Evaluation passed | 50-30-100ms soft confirm |

Haptic feedback is gated by `navigator.vibrate` support detection, making it a progressive enhancement on mobile devices.

### 7.5 Drag-and-Drop

The Node Palette supports two interaction modes:
1. **Click-to-add**: Clicking a node type adds it at a default position (quick placement)
2. **Drag-to-place**: Each palette item has a grip handle. Dragging sets `dataTransfer` with the node type, and the Canvas handles `onDrop` to convert screen coordinates to flow coordinates via `screenToFlowPosition()`. The node appears exactly where dropped.

---

## 8. State Management

### 8.1 Zustand Store

The `simulatorStore` manages all application state:

- `scenario`: Currently loaded scenario definition
- `nodes` / `edges`: The graph (array of SimNode / SimEdge)
- `selectedNodeId`: Currently selected node for inspection
- `deterministicResults`: Latest grading engine output
- `llmResults`: Latest LLM-as-judge output
- `history` / `historyIndex`: Undo/redo stack (up to 50 states)

### 8.2 React Flow Integration

React Flow v12 requires controlled mode for external state management. The Canvas component uses a subscribe pattern:

1. Local `useState` holds the React Flow-compatible node/edge arrays
2. `useSimulatorStore.subscribe()` syncs store changes to local state
3. `onNodesChange` / `onEdgesChange` apply position/dimension changes via `applyNodeChanges` / `applyEdgeChanges`
4. A `isDraggingRef` flag prevents store updates from overwriting drag-in-progress positions

This avoids the infinite re-render loop that occurs when React Flow's internal state and an external store fight over node positions.

### 8.3 History System

Every mutation (addNode, removeNode, addEdge, removeEdge, updateNodeConfig, resetBoard, loadAnswer) pushes to the history stack. Undo/redo traverses the stack and restores `nodes` + `edges` snapshots. History is capped at 50 entries.

---

## 9. Design System

The application uses a full dark theme with HSL-based design tokens defined in `index.css`:

```css
--background: 224 71% 4%;        /* Near-black blue */
--foreground: 213 31% 91%;       /* Light gray text */
--primary: 210 40% 58%;          /* Steel blue */
--accent: 210 40% 20%;           /* Deep accent */
--card: 224 71% 4%;              /* Card backgrounds */
--destructive: 0 63% 31%;        /* Error red */
```

Custom simulator tokens extend the system:
- `--gradient-primary`: 135deg gradient for premium surfaces
- `--shadow-elegant`: Primary-tinted drop shadows
- `--shadow-glow`: Luminous glow effects
- `--transition-smooth`: 0.3s cubic-bezier easing

Node colors per category:
- Brain: `purple-500` / `purple-950`
- Tool: `cyan-500` / `cyan-950`
- Control: `amber-500` / `amber-950`
- Integration: `indigo-500` / `indigo-950`
- I/O: `slate-400` / `slate-900`

---

## 10. Why This Matters

### 10.1 The Skills Gap

AI agent orchestration is becoming the core competency of software engineering. Every major LLM provider now offers agent frameworks (LangGraph, Semantic Kernel, AutoGen, CrewAI). Enterprise adoption is accelerating. But the talent pipeline is training engineers on the wrong abstractions.

A senior engineer who can design a multi-agent architecture that costs $2/request instead of $15/request saves their company $500K+/year at moderate scale. Yet there is no structured curriculum for this skill. Engineers learn by shipping to production and watching their AWS bills.

### 10.2 What This Platform Teaches

The simulator makes four principles tangible through interactive practice:

1. **Dispatch eliminates waste**: Most real-world inputs don't need the full pipeline. A $0.01 router call that skips a $3 executor chain saves 99.7% of cost on 70% of traffic.

2. **Context is finite**: An LLM with 128K tokens of context doesn't mean you should send 128K tokens. Context gates that compress or reset at architectural boundaries improve output quality while reducing cost.

3. **Structure beats inference**: A JSON output schema enforced at the API level (zero marginal cost) replaces an evaluator node that costs $2/call to verify the same structural properties.

4. **Locality of error handling**: A fallback router connected directly to a flaky tool node catches failures at the source. An evaluator at the end of a 10-node pipeline catches the symptom, not the cause, and adds latency to every request whether or not it fails.

### 10.3 Competitive Landscape

No existing platform addresses this space:
- **LeetCode/HackerRank**: Algorithm-focused, no infrastructure or architecture design
- **System Design Interview platforms** (e.g., SystemsExpert): Focus on distributed systems (load balancers, databases), not AI-specific orchestration
- **LangGraph/CrewAI documentation**: Tutorial-style, no interactive practice or grading
- **AI engineering courses** (DeepLearning.AI, etc.): Cover prompting and fine-tuning, not multi-agent architecture tradeoffs

The LangGraph Architecture Simulator occupies a unique position: it is the only platform that provides graded, interactive practice in AI agent architecture design with real cost/latency/reliability constraints.

---

## 11. Technical Decisions & Tradeoffs

### 11.1 Why Zustand over Redux

Zustand was chosen for minimal boilerplate, built-in subscribe API (critical for React Flow integration), and trivial undo/redo implementation via snapshot arrays. Redux's middleware pattern would add complexity without benefit for this use case.

### 11.2 Why React Flow v12 Controlled Mode

Controlled mode allows the Zustand store to be the single source of truth for node/edge state. This enables undo/redo, answer loading, and scenario reset without fighting React Flow's internal state. The tradeoff is complexity in the Canvas component (subscribe pattern, dragging ref), but this is localized to one file.

### 11.3 Why Deterministic + LLM Dual Grading

Deterministic-only grading can be gamed (e.g., adding 5 evaluators to max reliability score without considering if they're meaningfully placed). LLM-only grading is non-reproducible and can be fooled by architectures that "look right" but have structural flaws (cycles, disconnected nodes). Requiring both to pass independently provides robust assessment.

### 11.4 Why Edge Functions for LLM Calls

LLM API keys cannot be safely stored in frontend code. Edge Functions provide a server-side execution environment with secret management. The function acts as a thin proxy: it receives the student's architecture, formats the LLM prompt, calls Claude via the AI API, and returns the structured response.

### 11.5 Why Fixed Tool Costs Instead of Dynamic

Real tool costs vary by usage, but fixed costs create a deterministic game environment where students can reason precisely about budget allocation. This is a deliberate pedagogical choice: the learning objective is architectural tradeoffs, not cost estimation.

---

## 12. File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `src/types/simulator.ts` | ~80 | All type definitions |
| `src/data/models.ts` | ~120 | 10 LLM model definitions |
| `src/data/nodeTypes.ts` | ~200 | 14 node type metadata entries |
| `src/data/scenarios/index.ts` | ~350 | 7 scenario definitions |
| `src/data/scenarios/bloated-swarm.ts` | ~100 | Pre-placed broken architecture |
| `src/data/scenarios/mcp-migration.ts` | ~90 | Pre-placed tool sprawl architecture |
| `src/data/answers.ts` | ~500 | Optimal solutions for all 7 scenarios |
| `src/engine/GradingEngine.ts` | ~250 | Deterministic scoring engine |
| `src/engine/graphUtils.ts` | ~180 | Graph algorithms |
| `src/store/simulatorStore.ts` | ~200 | Zustand state management |
| `src/components/nodes/SimulatorNode.tsx` | ~220 | Custom React Flow node component |
| `src/components/edges/AnimatedEdge.tsx` | ~60 | Animated edge with pulse dots |
| `src/components/simulator/Canvas.tsx` | ~180 | React Flow canvas with DnD |
| `src/components/simulator/NodePalette.tsx` | ~130 | Node selection sidebar |
| `src/components/simulator/InspectorPanel.tsx` | ~280 | Node configuration panel |
| `src/components/simulator/HUD.tsx` | ~250 | Metrics, hints, actions toolbar |
| `src/components/simulator/ContextThermometer.tsx` | ~180 | Context pressure visualization |
| `src/components/simulator/ResultsPanel.tsx` | ~100 | Score display |
| `src/components/simulator/Editorial.tsx` | ~60 | Post-solve explanation modal |
| `src/pages/ScenarioSelect.tsx` | ~100 | Scenario browser |
| `src/pages/Simulator.tsx` | ~80 | Main layout |
| `src/lib/vibrate.ts` | ~40 | Haptic feedback patterns |
| `src/index.css` | ~120 | Design tokens, animations |
| `supabase/functions/grade-solution/index.ts` | ~100 | LLM-as-judge Edge Function |

**Total**: ~4,000+ lines of application code across 24 source files.

---

## 13. Summary

The LangGraph Architecture Simulator is a complete training platform for AI agent architecture design. It combines a visual graph editor (React Flow), a deterministic grading engine (graph algorithms for cost/latency/reliability), an LLM-as-judge (Claude Sonnet 4.5 via Edge Functions), and 7 progressive scenarios teaching four core design principles. The visual system encodes cost, reliability, and context pressure into node appearance (glow, depth, scale, thermometer), making architectural quality visible and intuitive. It addresses a genuine gap in the AI engineering education landscape where no existing platform provides graded, interactive practice in multi-agent orchestration design.
