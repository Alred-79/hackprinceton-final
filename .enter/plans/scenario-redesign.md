# Scenario Redesign v2: 2 Compound Scenarios + Engine Support

## Context

Current 7 scenarios each teach ~1 principle. We're replacing 3 redundant/shallow ones (Triage Nurse, Trading Floor, Full Stack Agent) with 2 compound scenarios that teach multiple principles together. Also adding grading engine support for `outputSchema` so P3 (structural guarantees) is mechanically rewarded.

## The 4 Design Principles

- **P1 Dispatch**: Most systems are routing problems — a Router eliminates 60-80% of unnecessary work
- **P2 Context Mgmt**: Context is a resource you manage — Structured Sendoff vs Full Reset is the skill
- **P3 Structural Guarantees**: Output schemas beat runtime checks — enforce quality through structure at zero cost
- **P4 Error@Source**: Handle errors where they happen — Fallback Router at the tool, not Evaluator at the end

## Scenarios After Redesign (6 total)

| # | Scenario | Mode | Difficulty | Primary Principles |
|---|---|---|---|---|
| 1 | Bloated Swarm | fixer | easy | Consolidation, model-task fit |
| 2 | Gold Plater | fixer | easy | Model-task fit |
| 3 | Content Machine | architect | medium | P2 (eval loop context), eval loops |
| 4 | Safety Net | architect | medium | P4 (fallback routing) |
| 5 | **The Ops Center** (NEW) | architect | medium-hard | P1 + P2 + P3 + P4 |
| 6 | **The Due Diligence Engine** (NEW) | architect | hard | P2 (multi-stage) + P3 + P4 + eval loops |

### Key: the 2 new scenarios are architecturally DISTINCT

- **Ops Center** = fan-out → merge → route → fan-out (WIDE — horizontal branching)
- **Due Diligence** = plan → gather → gate → draft → evaluate → revise loop (DEEP — vertical pipeline with iteration)

---

## New Scenario 1: "The Ops Center" (~11 nodes, medium-hard)

**Narrative:** IT operations center handling incoming incidents. Alerts arrive as unstructured text. System must gather diagnostics from multiple sources (some unreliable), filter the noise, classify severity, then produce a structured incident report.

**Key insight:** Gather data FIRST, then route. You can't triage without intelligence.

**Optimal architecture:**
```
                               ┌→ WebSearch(status pages) ─────────────┐
Input → (fan-out to 3 tools) → ├→ FileRW(logs) → FallbackRouter ──────┼→ ContextGate → Router(severity) → Executor(critical, +schema) → Evaluator → Output
                               │                    ↓ failure          │                               ↗
                               │               Executor(log fallback) ─┘           Executor(routine, +schema) ──→ Evaluator
                               └→ RAG(runbooks) ───────────────────────┘
```

**Nodes (11):**
1. Input
2. WebSearch (status pages)
3. FileRW (system logs)
4. RAG (runbooks/playbooks)
5. FallbackRouter (catches log retrieval failures — P4)
6. Executor "Log Fallback" (acknowledges missing logs, suggests alternatives — P4)
7. ContextGate (structured_sendoff — filters noisy diagnostic data into clean brief — P2)
8. Router (classifies severity: Critical vs Routine based on filtered data — P1)
9. Executor "Critical Response" (gpt-4o, with outputSchema for incident report JSON — P3)
10. Executor "Routine Response" (gpt-4o-mini, with outputSchema — P3)
11. Evaluator (completeness + safety check)
12. Output

**Why each node earns its place:**
- 3 parallel tools: realistic diagnostic gathering, shows fan-out pattern
- FallbackRouter + Log Fallback: P4 — errors handled at the tool, not caught late by evaluator
- ContextGate: P2 — raw diagnostic output is noisy (HTML, stack traces, duplicate data). Without filtering, the downstream LLM gets polluted context
- Router AFTER data: P1 — you classify severity based on what you found, not based on the raw alert text
- 2 response executors with schema: P3 — incident reports MUST have structure (severity, affected_systems, root_cause, mitigation_steps). Schema enforces this at zero cost vs an evaluator checking format
- Evaluator: checks content quality (not format — that's handled by schema)

**Budget:**
- Cost: ~$3.45 total (well under $14 max)
- Latency: ~5.1s longest path (under 10s max)
- Reliability target: 82 min

**Available nodes:** input, output, executor, evaluator, router, web_search, file_rw, tool_rag, context_gate, fallback_router

**failureSequence:** `{ nodeType: "file_rw", pattern: [true, false, true], failureMessage: "System logs returned corrupted/partial data" }`

---

## New Scenario 2: "The Due Diligence Engine" (~12 nodes, hard)

**Narrative:** M&A due diligence system. Given a target company, research from multiple sources, handle unreliable legal document retrieval, manage context across pipeline stages, and produce a structured investment memo — iterating until quality is sufficient.

**Key insight:** Multi-stage pipelines need context management at EACH stage boundary, and eval loops need context gates to prevent draft pollution.

**Optimal architecture:**
```
Input → Executor(planner) → ┌→ WebSearch(market data) ──────────────────┐
                            ├→ FileRW(legal docs) → FallbackRouter ─────┼→ ContextGate#1 → Executor(memo writer, +schema) → Evaluator ──pass──→ Output
                            │                           ↓ failure       │                        ↑                            │
                            │                     Executor(gap noter) ──┘                   ContextGate#2 ←────────fail──────┘
                            └→ RAG(company data) ───────────────────────┘
```

**Nodes (12):**
1. Input
2. Executor "Research Planner" (gpt-4o-mini — decomposes the question into research tasks)
3. WebSearch (public market data, news, SEC filings)
4. FileRW (internal legal documents, contracts)
5. RAG (company knowledge base, prior memos)
6. FallbackRouter (catches legal doc failures — P4)
7. Executor "Gap Noter" (gpt-4o-mini — flags what legal data is missing, suggests workarounds — P4)
8. ContextGate #1 (structured_sendoff — merges 3 research streams into a clean synthesis brief — P2)
9. Executor "Memo Writer" (gpt-4o, with outputSchema for investment memo JSON — P3)
10. Evaluator (memo quality: completeness, risk coverage, recommendation justification)
11. ContextGate #2 (structured_sendoff — strips old draft, keeps eval feedback + original brief — P2 in loop)
12. Output

**Why each node earns its place:**
- Planner: decomposes question into research tasks (real pattern — you plan before you search)
- 3 parallel research tools: one per data source (market, legal, company history)
- FallbackRouter + Gap Noter: P4 — legal docs are unreliable (25% failure). The gap noter explicitly flags what's missing so the memo writer can caveat appropriately, rather than an end-evaluator catching bad output
- ContextGate #1: P2 — raw research is verbose (full SEC filings, legal boilerplate). The handoff brief extracts: key financial metrics, identified risks, team info, competitive position
- Memo Writer with schema: P3 — investment memos have strict structure (company_overview, financials, risks, team, recommendation, confidence_level). Schema enforces this
- Evaluator → ContextGate #2 → loop: P2 — the CRITICAL context decision. If you loop the full draft + feedback + original research back, context explodes. Gate #2 strips the old draft and only passes: evaluator feedback + original brief. Memo writer starts fresh with guidance. THIS is "compacting a Claude Code session vs seeding a fresh sub-agent"
- Two context gates serve DIFFERENT purposes (filtering vs loop hygiene) — teaches that gates aren't one-trick

**Budget:**
- Cost: ~$8.60 total (under $15 max, accounting for ×3 loop on memo writer + evaluator)
- Latency: ~9.7s longest path with loop multiplier (under 14s max)
- Reliability target: 80 min

**Available nodes:** all 10 types

**failureSequence:** `{ nodeType: "file_rw", pattern: [false, true, true, false], failureMessage: "Legal documents returned incomplete/corrupted data" }`

---

## Engine Support: outputSchema Scoring

### GradingEngine.ts changes

Add a **Structural Guarantee bonus** that rewards outputSchema usage:

```typescript
// After evaluator bonuses section, before tool count penalties:

// Output schema bonus (structural guarantees)
const schemaNodes = nodes.filter((n) =>
  (n.type === "executor" || n.type === "evaluator") && n.config.outputSchema?.trim()
);
let schemaBonus = 0;
schemaNodes.forEach((n, i) => {
  // Validate it's parseable JSON
  try {
    JSON.parse(n.config.outputSchema!);
    const bonus = i === 0 ? 8 : 3; // First schema +8%, additional +3%
    bonuses.push({ label: `Schema: ${n.config.label}`, value: bonus });
    schemaBonus += bonus;
  } catch {
    warnings.push(`${n.config.label}: outputSchema is not valid JSON`);
  }
});

// Add to reliability total
reliability += schemaBonus;
```

**Why this scoring:**
- First valid schema: +8% reliability (significant, encourages adoption)
- Additional schemas: +3% each (diminishing returns, discourages spam)
- Invalid JSON: warning but no bonus (teaches that schemas must be valid)
- This mirrors the evaluator bonus pattern (25/10/2) but at lower values since schemas are "free" (no cost/latency)

---

## Files to Modify

| File | Change |
|---|---|
| `src/data/scenarios/index.ts` | Remove triage-nurse, trading-floor, full-stack-agent. Add ops-center + due-diligence-engine |
| `src/data/answers.ts` | Remove old 3 answers, add 2 new answers with full node configs |
| `src/engine/GradingEngine.ts` | Add outputSchema bonus scoring |
| `src/pages/ScenarioSelect.tsx` | Update to show 6 scenarios (2 fixer, 4 architect) |
| `src/types/simulator.ts` | Add optional `difficulty` field to Scenario type |

Files NOT changed: nodeTypes.ts, models.ts, InspectorPanel.tsx (schema UX is already functional), bloated-swarm.ts, SimulatorNode.tsx, Canvas.tsx, store

---

## Verification

1. **Cost math**: Manually verify both answers fit within maxCost (including loop multipliers)
2. **Latency math**: Verify longest-path latency for both answers
3. **Schema bonus**: Test that the grading engine awards the bonus for valid schemas and warns on invalid ones
4. **Show Answer**: Confirm answer button loads correct architecture for all 6 scenarios
5. **Lint + Build**: Must pass
