# reAgent

TRY OUT THE PRODUCT HERE
https://fb5ad316cb9a40f7ad869c1205a34a60.prod.enter.pro

LEARN WHAT IT DOES HERE: https://devpost.com/software/reagent


reAgent is a visual sandbox for learning and designing multi-agent AI systems. The core idea is simple: before you spend money running a real pipeline, you should be able to draw it out, see what it costs, and understand why one architecture is better than another.

We built this at HackPrinceton.

---

## What it does

There are two main modes.

**Scenario Mode** is like Leetcode for agent architecture. You get a broken or inefficient multi-agent system and your job is to fix it. Maybe someone built seven separate Claude Opus agents for a customer support bot when one router and two executors would do the same job for a fraction of the cost. You drag nodes around, rewire the graph, swap out models, and submit. Each node is a tradeoff. The grading engine runs a deterministic analysis of your design. It calculates the real dollar cost per run, estimates p95 latency based on your topology, checks for things like missing context gates, disconnected nodes, assess each prompt, or loops without termination conditions, and scores your solution against the fully optimized answer.

**Workflow Architect** is a blank canvas. You paste in a description of what you're trying to build (something like "when a Sentry alert fires, fetch the stack trace, query our database for affected users, and post a summary to Slack") and it generates a suggested agent graph for you. From there you can edit it, see the cost breakdown, and understand why each node is where it is.

The three scenarios that ship with it cover a bloated customer support swarm, a threat analysis pipeline that needs a feedback loop, and an MCP server migration. Each one teaches a different principle: model consolidation, evaluator-executor loops, and tool abstraction.

---

## Stack

- React + TypeScript + Vite
- React Flow for the graph canvas
- Three.js for the landing page (synthwave tunnel scene with bloom post-processing)
- Tailwind + shadcn/ui for components
- Supabase for the Workflow Architect backend (the AI call that generates graphs from prompts)
- Zustand for simulator state

---

## Running it locally

```bash
pnpm install
pnpm dev
```

Opens at `http://localhost:8080` (or the next available port). The landing page loads first — hit start to get to the scenario selector.

---

## Project structure

```
src/
  pages/
    SynthwaveLanding.tsx   # the intro screen
    ScenarioSelect.tsx     # scenario + mode picker
    Simulator.tsx          # the main canvas + grading flow
    WorkflowArchitect.tsx  # prompt-to-graph generator
  engine/
    GradingEngine.ts       # deterministic cost/latency/score computation
    graphUtils.ts          # cycle detection, connectivity checks, etc.
  data/
    scenarios/             # each scenario is a self-contained config
    models.ts              # model registry with cost-per-token data
    nodeTypes.ts           # node type definitions
  components/
    simulator/             # HUD, inspector panel, node palette, results
    architect/             # workflow result display
```

---

## How grading works

When you submit a solution, the grading engine walks your graph and computes everything deterministically. No LLM involved. It calculates cost by summing up model costs per node (with a loop multiplier for cyclic paths), estimates latency by finding the critical path through the DAG, and checks for structural issues like disconnected nodes, missing evaluators in agentic loops, or chained executors that bypass context gates. Bonuses and penalties adjust your base score, and anything that hits a defined threshold in the scenario's answer key tips the result from "passed" to "optimal."

---

## Notes

The Workflow Architect feature requires a Supabase project with a deployed edge function. The scenario grading runs entirely in the browser.
