# Scenario Redesign: Compound Principle Scenarios

## Context
The current 7 scenarios each teach ~1 principle in isolation with relatively small graphs (5-8 nodes). The user wants scenarios that are more complex, teach **multiple principles simultaneously**, and better represent real long-running agent architectures. The 4 core design principles to embed:

1. **Dispatch over sequence** — Most systems are routing problems, not pipelines
2. **Context is a resource you manage** — Structured Sendoff vs Full Reset is the core skill
3. **Structural guarantees beat runtime checks** — Output schemas > evaluators when possible
4. **Handle errors where they happen** — Fallback at the tool, not evaluation at the end

## Audit of Current Scenarios vs Principles

| Scenario | P1 Dispatch | P2 Context | P3 Structure | P4 Error@Source | Nodes | Verdict |
|---|---|---|---|---|---|---|
| Bloated Swarm (fixer) | YES (consolidate) | no | no | no | 10→6 | Fine for intro, keep as-is |
| Gold Plater (fixer) | no | no | no | no | 6 | Fine for intro, keep as-is |
| Triage Nurse | YES (3-way route) | no | no | no | 7 | Shallow — just routing |
| Trading Floor | partial (parallel fork) | YES (1 gate) | no | no | 8 | Decent but linear |
| Content Machine | partial (route) | YES (loop gate) | no | no | 8 | Good loop example but shallow context |
| Safety Net | no | no | no | YES (fallback) | 7 | Single-principle |
| Full Stack Agent | partial (parallel) | YES (1 gate) | no | no | 8 | Very similar to Trading Floor |

**Key gaps:**
- No scenario uses `outputSchema` / structural guarantees at all
- No scenario combines error handling with other principles
- No scenario has multiple eval loops or multi-stage context management
- Full Stack Agent is basically Trading Floor v2 — redundant
- Triage Nurse is too simple for "architect" mode

## Plan: Replace 3 Scenarios, Keep 4

**Keep unchanged (they serve their introductory purpose well):**
- Bloated Swarm (easy fixer — intro to consolidation)
- Gold Plater (easy fixer — intro to model-task fit)
- Safety Net (focused error-handling lesson — keep simple)
- Content Machine (good eval loop lesson — keep)

**Replace these 3 with compound-principle scenarios:**
- ~~Triage Nurse~~ → **"The Ops Center"** (medium, 12-14 nodes)
- ~~Trading Floor~~ → **"The Due Diligence Engine"** (hard, 14-16 nodes)
- ~~Full Stack Agent~~ → **"The Code Review Pipeline"** (hard, 13-15 nodes)

---

## New Scenario 1: "The Ops Center" (replaces Triage Nurse)

**Narrative:** You're building an IT operations center that handles incoming incidents. Incidents arrive as unstructured alerts (monitoring, user reports, logs). The system must classify severity, dispatch to the right team, gather diagnostic data, and produce a structured incident report.

**Principles taught:** P1 (dispatch), P2 (context management across stages), P3 (structured output schemas for incident reports), P4 (tool failures on log retrieval)

**Optimal architecture (~13 nodes):**
```
Input → Router(severity: P1/P2/P3) →
  P1 path: Executor(urgent handler, gpt-4o) → ...
  P2 path: Executor(standard handler, gemini-pro) → ...
  P3 path: Executor(low-pri handler, gpt-4o-mini) → ...
→ parallel diagnostic tools: [WebSearch(status page), FileRW(logs), RAG(runbooks)]
→ FallbackRouter(after FileRW for log failures)
→ ContextGate(structured_sendoff — filter diagnostics)
→ Executor(incident report writer, with outputSchema for structured JSON)
→ Evaluator(completeness check)
→ Output
```

**What makes it hard:**
- 3-way severity dispatch (P1)
- Parallel diagnostic gathering with fallback on log retrieval (P4)
- Context gate to filter noisy diagnostics before report writing (P2)
- Output schema on the report writer to enforce structured incident format (P3)
- Evaluator for completeness check creates eval loop back through context gate (P2 again)

**Available nodes:** input, output, executor, evaluator, router, web_search, file_rw, tool_rag, context_gate, fallback_router

**Mode:** architect | maxCost: $18 | maxLatency: 12s | minReliability: 82

---

## New Scenario 2: "The Due Diligence Engine" (replaces Trading Floor)

**Narrative:** You're building a due diligence system for M&A (mergers & acquisitions). Given a target company, the system must research financials, legal risks, market position, and team — then produce a structured investment memo. Each research branch has different reliability (legal docs fail 25% of the time) and context budgets.

**Principles taught:** P1 (4-way parallel dispatch), P2 (multiple context gates — one per branch + one before synthesis), P3 (structured memo schema), P4 (fallback on legal doc retrieval)

**Optimal architecture (~15 nodes):**
```
Input → Executor(research planner, gpt-4o-mini)
→ splits to 4 parallel branches:
  Branch A: WebSearch(financials) → ContextGate(extract key metrics only)
  Branch B: FileRW(legal docs) → FallbackRouter → success: Executor(legal analyzer) / failure: Executor(flag missing docs)
  Branch C: RAG(market reports) → ContextGate(relevant findings only)
  Branch D: WebSearch(team/leadership) → ContextGate(bios + track record only)
→ ContextGate(structured_sendoff — merge 4 branch summaries into synthesis brief)
→ Executor(memo writer, gpt-4o, with outputSchema for investment memo JSON)
→ Evaluator(memo quality + completeness)
→ Output
```

**What makes it hard:**
- 4 parallel research branches — one for each diligence area (P1)
- 3 per-branch context gates + 1 merge gate = 4 total context management decisions (P2)
- Legal doc retrieval has failure sequence, needs fallback router (P4)
- Memo writer uses output schema to enforce investment memo structure (P3)
- Evaluator with fail→context gate→rewrite loop (P2 + eval loops)

**Available nodes:** all 10 types

**Mode:** architect | maxCost: $20 | maxLatency: 14s | minReliability: 80

---

## New Scenario 3: "The Code Review Pipeline" (replaces Full Stack Agent)

**Narrative:** You're building an automated code review system. It receives a pull request diff, classifies the change type (bug fix, feature, refactor, docs), runs appropriate analysis (security scan, style check, logic review), and produces a structured review with actionable feedback. Different change types need different depth of review.

**Principles taught:** P1 (dispatch by change type), P2 (context gates between analysis and synthesis), P3 (output schemas for structured review comments JSON), P4 (tool failures on security scan)

**Optimal architecture (~14 nodes):**
```
Input → Router(change type: bugfix/feature/refactor/docs)
→ bugfix path: Executor(bug analysis, gpt-4o) + WebSearch(CVE lookup)
→ feature path: Executor(feature review, gemini-pro) + RAG(coding standards)
→ refactor path: Executor(refactor analysis, gpt-4o-mini)
→ docs path: Executor(docs review, gpt-4o-mini)
Each path → ContextGate(structured_sendoff — extract findings only)
→ Executor(review synthesizer, with outputSchema for review JSON)
→ Evaluator(actionability check — are comments constructive?)
→ fail: ContextGate → loop back to synthesizer
→ pass: Output
```

**What makes it hard:**
- 4-way dispatch by change type (P1)
- Some paths use tools (web search for CVE, RAG for standards) (P4 opportunity)
- Context gates between each analysis path and the synthesizer (P2)
- Structured output schema for review comments (P3)
- Eval loop with context gate for non-actionable feedback (P2 + eval loops)

**Available nodes:** input, output, executor, evaluator, router, web_search, tool_rag, context_gate

**Mode:** architect | maxCost: $16 | maxLatency: 10s | minReliability: 85

---

## Output Schema UX Enhancement

The current `outputSchema` field is a raw JSON textarea — not very usable. To make structural guarantees more learnable, enhance the InspectorPanel:

1. Add a **visual JSON schema builder** section when outputSchema is focused:
   - Show a helper with common field templates (string, number, boolean, array)
   - Add a "Validate JSON" button that highlights syntax errors
   - Show a preview of what the schema enforces

2. Add a **schema preset dropdown** for common patterns:
   - "Structured Report" → `{type, severity, summary, details, recommendations}`
   - "Review Comments" → `{file, line, severity, comment, suggestion}`
   - "Investment Memo" → `{company, recommendation, financials, risks, team}`

This makes P3 (structural guarantees) more discoverable and less intimidating.

---

## Files to Modify

| File | Change |
|---|---|
| `src/data/scenarios/index.ts` | Replace triage-nurse, trading-floor, full-stack-agent with 3 new scenarios |
| `src/data/answers.ts` | Replace answers for old 3 scenarios, add answers for new 3 |
| `src/types/simulator.ts` | Add optional `difficulty` field to Scenario type |
| `src/components/simulator/InspectorPanel.tsx` | Enhance outputSchema UX with validation + presets |
| `src/pages/ScenarioSelect.tsx` | Show difficulty badges, add section for "Compound" scenarios |
| `src/data/scenarios/bloated-swarm.ts` | No change |
| `src/data/nodeTypes.ts` | No change |
| `src/data/models.ts` | No change |
| `src/engine/GradingEngine.ts` | Add bonus for outputSchema usage (structural guarantee bonus) |

---

## Verification

1. **Cost math**: For each new answer, manually calculate total cost against maxCost (accounting for loop multipliers)
2. **Latency math**: Calculate longest-path latency against maxLatency
3. **Grading engine**: Verify new answers score within all thresholds
4. **Show Answer**: Confirm the answer button loads correct architecture for all 7 scenarios
5. **Lint**: Run lint to confirm no errors
6. **Build**: Confirm successful build
