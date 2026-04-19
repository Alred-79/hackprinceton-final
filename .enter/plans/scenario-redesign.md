# LangGraph Architecture Simulator -- Presentation Script

---

**[Open on the scenario select screen]**

67% of AI engineering job postings now require "agent orchestration" as a skill. Yet the entire industry trains engineers the same way we did in 2004 -- memorize algorithms, pass a whiteboard test, ship to production and pray.

LeetCode taught a generation how to sort arrays. Nobody is teaching them how to *not* burn $40,000 a month on a chatbot that calls GPT-4 for every message.

This is the LangGraph Architecture Simulator. It's LeetCode for AI agent design -- except instead of optimizing time complexity, you're optimizing cost, latency, and reliability across multi-agent architectures.

**[Click into "The Bloated Swarm" scenario]**

The core loop: you're given a broken or empty architecture and a budget. 14 node types -- executors, routers, evaluators, context gates, MCP servers, human-in-the-loop checkpoints, code execution sandboxes, RAG retrievers, API connectors. You drag them onto a **React Flow canvas**, wire them together, configure which LLM each node runs, and hit Evaluate.

**[Drag a few nodes, connect them, point to the HUD]**

Scoring is hybrid. A **deterministic grading engine** runs graph analysis in real-time -- cycle detection via DFS, longest-path latency via topological sort, parallel branch detection, cost accumulation with loop multipliers. It calculates your architecture's exact dollar cost, p95 latency, and reliability score *before* you submit. Then an **LLM-as-judge running Claude Sonnet** evaluates your design decisions qualitatively -- did you route before you computed? Did you put a fallback where the failure happens, or where it hurts?

**[Point to the cost/latency meters in the HUD, then the glow on nodes]**

Every node *shows* you what it costs. The glow goes from yellow to red based on cost ratio. The 3D depth of each node scales with its reliability contribution. The **Context Thermometer** shakes and steams when you're over 25 tools -- because context window management is a resource problem, not a pipe you leave open.

**[Open the MCP Migration scenario]**

7 scenarios across three difficulty tiers teach four design principles that separate junior from senior AI engineers:

One -- **dispatch, not sequence**. A router before your executor eliminates 60-80% of unnecessary LLM calls. Two -- **context is a resource you manage**. Context gates with structured sendoffs beat dumping everything into one prompt. Three -- **structural guarantees beat runtime checks**. A JSON output schema at zero cost replaces an evaluator node that costs $2 per call. Four -- **handle errors where they happen**. A fallback router on the tool that fails beats an evaluator at the end that catches nothing.

**[Click "Show Answer" on a scenario, point to the optimal architecture]**

Every scenario has a verified optimal solution. The MCP Migration scenario teaches you to refactor 12 scattered tools into domain-organized MCP servers -- the same pattern teams at Anthropic and OpenAI are deploying right now. The Ops Center scenario requires human-in-the-loop on critical paths -- because 100% automation is the wrong answer when the stakes are high enough.

**[Point to the score breakdown panel]**

The grading engine rewards these principles mechanically. Output schemas give +8% reliability. MCP servers with 3+ tools give +5%. Human review adds +15%. But evaluator stacking has diminishing returns -- your third evaluator only adds +2%. The system teaches you that *architecture is the optimization*, not more compute.

This isn't a toy. It's a training platform for the skill that will define the next decade of software engineering -- and right now, nobody else is teaching it.

---

*Stats to drop naturally if asked:*
- 14 node types, 10 LLM models, 7 scenarios
- Hybrid deterministic + LLM scoring (dual-pass grading)
- Full React Flow canvas with drag-and-drop, undo/redo, haptic feedback
- Real-time cost/latency/reliability telemetry
- Built on React + TypeScript + Zustand + Supabase Edge Functions
