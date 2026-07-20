from fastapi.testclient import TestClient

from reagent_runtime.api import app

client = TestClient(app)


def test_health_and_capabilities() -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["external_model_requests"] is False

    capabilities = client.get("/api/capabilities")
    assert capabilities.status_code == 200
    body = capabilities.json()
    assert set(body["executable_scenarios"]) == {
        "threat-analyst",
        "bloated-swarm",
        "content-machine",
        "due-diligence-engine",
        "gold-plater",
        "mcp-migration",
        "ops-center",
        "safety-net",
    }
    assert body["design_only_scenarios"] == []
    assert len(body["scenario_runtimes"]) == 8


def test_create_baseline_run() -> None:
    response = client.post(
        "/api/runs",
        json={"scenario_id": "threat-analyst", "variant": "baseline"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scenario_id"] == "threat-analyst"
    assert body["terminal_status"] == "succeeded"
    assert body["metrics"]["critical_output_escape"] is True
    assert body["fault_plan"][0]["case"] == "false_claim"

    replay = client.post(f"/api/runs/{body['run_id']}/fixture-replay", json={})
    assert replay.status_code == 200
    assert replay.json()["scenario_id"] == "threat-analyst"


def test_safety_net_executes_and_runs_pydantic_evals() -> None:
    run = client.post(
        "/api/runs",
        json={"scenario_id": "safety-net", "variant": "hardened"},
    )
    assert run.status_code == 200
    run_body = run.json()
    assert run_body["terminal_status"] == "succeeded"
    assert run_body["metrics"]["task_pass"] is True
    assert run_body["fault_plan"] == []
    assert any(item["layer"] == "agent_output" for item in run_body["pydantic_evidence"])
    assert any(item["layer"] == "edge_contract" for item in run_body["pydantic_evidence"])

    evals = client.post("/api/evals/run", json={"scenario_id": "safety-net"})
    assert evals.status_code == 200
    assert evals.json()["engine"] == "pydantic-evals"
    assert evals.json()["failed"] == 0


def test_workflow_lookup_is_scenario_scoped() -> None:
    registered = client.get("/api/workflows/threat-analyst/hardened")
    assert registered.status_code == 200

    safety = client.get("/api/workflows/safety-net/hardened")
    assert safety.status_code == 200
    assert safety.json()["id"] == "safety-net-hardened"

    missing = client.get("/api/workflows/not-registered/hardened")
    assert missing.status_code == 404
