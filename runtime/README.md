# ReAgent Runtime

The runtime executes all eight registered scenarios with LangGraph, Pydantic AI output
contracts, edge TypeAdapters, per-scenario Pydantic Evals, deterministic fixtures, SQLite run
storage, and server-owned approvals for the Threat Analyst publication boundary.

```bash
uv sync
uv run uvicorn reagent_runtime.api:app --reload --port 8000
```

Core fixture execution never needs a provider key. Live-model support is an explicit optional mode.
