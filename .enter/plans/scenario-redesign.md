# New Showcase Scenario — Options & Analysis

## Goal
Create a single "demo-ready" compound scenario (difficulty: hard, fixer mode) that showcases the maximum number of app features while remaining a rock-solid, believable workflow.

## Feature Audit — What the Scenario Must Exercise

### Node Types to Showcase (13 of 14 available)
| Node | Broken Graph | Optimal Graph |
|------|-------------|---------------|
| executor | Multiple, all claude-opus | Right-sized per task |
| evaluator | Missing entirely | +25 bonus, eval loop |
| router | Missing or misplaced | Severity routing with "Critical" keyword → enables +15 human review |
| context_gate | Missing | x2: research filter + revision hygiene (+5 each) |
| web_search | Via bloated MCP | Via organized MCP |
| file_rw | Direct, no fallback | Direct + fallback_router |
| tool_rag | Via bloated MCP | Via organized MCP |
| code_exec | Via bloated MCP | Direct or via MCP |
| api_call | Via bloated MCP | Via organized MCP |
| fallback_router | Missing | After unreliable file_rw (+15 display bonus) |
| human_review | Missing | On critical path (+15 high-stakes bonus) |
| mcp_server | 4-5 single-tool MCPs (penalties!) | 1-2 well-grouped MCPs (3+ tools = +5 bonus) |

### Grading Rules Exercised
**Penalties on the broken graph:**
- MCP servers with <=1 tool: -3 each (x4-5 = -12 to -15)
- No evaluator: no bonus (0/25 possible)
- No context gates: 0 bonus
- No output schema: 0 bonus
- No fallback on unreliable tool: -20
- No human review: 0 bonus
- Massive cost from claude-opus everywhere
- High latency from sequential chaining

**Bonuses on the optimal graph:**
- Evaluator: +25
- Context gates x2: +10
- Output schema: +8
- MCP server (3+ tools): +5
- Fallback router: +15 (display)
- Human review (high-stakes): +15
- **Total architecture bonuses: +78**

---

## Three Theme Options

### Option A: "The Threat Analyst" — Cybersecurity SOC

**Narrative:** A Security Operations Center inherited an automated threat intelligence system that's bleeding money. The previous engineer built it with 5 separate MCP servers (one per tool), every executor runs claude-opus, there's no quality gate, no error handling on the threat feed parser, and critical alerts go straight to output without human review. Last week it auto-published an unreviewed "CRITICAL" threat brief that turned out to be a false positive. Leadership wants it fixed yesterday.

**Why it works for demo:**
- Cybersecurity is universally understood and high-stakes
- "Auto-published false positive" is viscerally scary — justifies every feature
- The broken graph is visually messy (5 MCPs + 4 executors, all sequential)
- The optimal graph is clean and elegant
- Every feature has a natural justification (not forced)

**Initial broken graph (10 nodes):**
```
Input → MCP-search(web_search) → MCP-feed(file_rw) → MCP-intel(tool_rag) → MCP-analysis(code_exec) → MCP-notify(api_call)
                                                                                                           ↓
Exec-enricher(opus) → Exec-correlator(opus) → Exec-reporter(opus) → Output
```
Problems: 5 single-tool MCPs (-15), all opus ($45+), sequential (slow), no evaluator, no fallback, no human review, no schema.

**Optimal solution (14 nodes):**
```
Input → Intel MCP(web_search, tool_rag, api_call) ──→ Context Gate → Router(Critical/Standard)
            ↑                                              ↑          ↓Critical          ↓Standard
     file_rw → Fallback Router → gap_noter ─────────────────┘     Exec-critical(gpt-4o) → Human Review → Eval → Output
                                                                   Exec-standard(mini)  ──────────────→ Eval ↗
                                                     code_exec ──────────────────────────────────────────┘
                                                                  Eval fail → Revision Gate → Exec loop
```

**Unique appeal:** Every node serves the narrative. The threat feed is unreliable (real-world). Critical threats need human eyes (real-world). The eval loop catches bad analysis before it ships.

---

### Option B: "The Launch Controller" — Release Engineering

**Narrative:** A platform engineering team has an automated release validation system that's supposed to catch bad deploys before they hit production. The current version? One engineer built it with separate MCP servers for each validation tool, every agent runs the most expensive model, tests run sequentially (taking forever), and there's no human gate before pushing to production. Last sprint, a breaking change made it to production because nobody reviewed the auto-generated release report.

**Why it works for demo:**
- Every engineer understands release pipelines
- "Breaking change hit production" is relatable and high-stakes
- Natural parallel fan-out (tests can run simultaneously)
- Code_exec is a first-class citizen (running tests)
- Release reports have natural structure (output schema)

**Initial broken graph:**
```
Input → MCP-tests(code_exec) → MCP-logs(file_rw) → MCP-monitoring(web_search) → MCP-docs(tool_rag) → MCP-notify(api_call)
                                                                                                         ↓
Exec-validator(opus) → Exec-reporter(opus) → Output
```

**Optimal solution:**
Similar structure to Option A but with release engineering terminology.

**Unique appeal:** The code_exec node feels natural (running tests). The before/after is dramatic — sequential test execution vs parallel.

---

### Option C: "The Compliance Engine" — Financial Regulation

**Narrative:** A fintech's compliance pipeline monitors transactions, checks regulatory databases, and generates audit reports. The current system has one MCP per data source, everything runs on claude-opus, and there's no human review — even for flagged sanctions violations. The regulator just asked why a suspicious transaction was auto-cleared without human oversight.

**Why it works for demo:**
- Finance/compliance is high-stakes and universally understood
- "Auto-cleared sanctions violation" justifies human review perfectly
- Regulatory reports MUST be structured (output schema is natural)
- Transaction monitoring has natural severity tiers (router)

**Unique appeal:** Compliance is the ultimate "you need human review" domain. Schema enforcement is non-negotiable.

---

## On Kafka / Event Streaming

You mentioned potentially adding a Kafka-like tool. Two approaches:

**Approach 1 — Use existing `api_call` node:** Rename/relabel an api_call node as "Event Publisher" or "Alert Dispatcher" in the scenario. The grading engine already handles api_call. Zero code changes. It's semantically close enough — publishing to Kafka IS an API call.

**Approach 2 — Add a new `event_stream` node type:** Create a new node type with its own cost/latency characteristics (e.g., async pub/sub semantics, 0.12 cost, 0.3s latency). This would require changes to types, nodeTypes, grading engine, and node rendering. More impressive in a demo ("look, we even have event streaming") but more work and only used by one scenario.

**Recommendation:** Use `api_call` for now. If you want the visual differentiation, we can add a lightweight `event_stream` node later.

---

## Recommendation

**Option A ("The Threat Analyst")** is the strongest showcase because:
1. Every feature has a visceral justification (false positive → needs eval; unreviewed critical → needs human review)
2. The broken graph has the MOST penalties (5 single-tool MCPs + no eval + no fallback + no schema + no human review)
3. The before/after transformation is the most dramatic
4. Cybersecurity is universally compelling
5. It's distinct from existing scenarios (no overlap with ops-center's IT incident theme or due-diligence's M&A theme)

The broken graph would score: ~$50+ cost, ~20s latency, ~70% reliability (multiple MCP penalties, no bonuses)
The optimal graph would score: ~$8 cost, ~38s latency, 97% reliability (all bonuses firing)
