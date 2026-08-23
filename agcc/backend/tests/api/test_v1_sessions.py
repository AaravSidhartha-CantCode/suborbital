from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from agcc.api.app import create_app
from agcc.api.v1 import SessionRepository
from tests.api.test_api import scenario_payload


def test_session_create_isolation_and_delete() -> None:
    client = TestClient(create_app())
    first = client.post("/api/v1/sessions").json()["session_id"]
    second = client.post("/api/v1/sessions").json()["session_id"]
    assert first != second
    assert len(first) >= 32
    assert client.get("/api/v1/catalog/stations").status_code == 401
    assert client.get(
        "/api/v1/catalog/stations", headers={"X-AGCC-Session": first}
    ).status_code == 200
    assert client.delete(f"/api/v1/sessions/{first}").status_code == 200
    assert client.get(
        "/api/v1/catalog/stations", headers={"X-AGCC-Session": first}
    ).status_code == 404
    assert client.get(
        "/api/v1/catalog/stations", headers={"X-AGCC-Session": second}
    ).status_code == 200


def test_inactive_sessions_are_evicted_after_twenty_four_hours() -> None:
    repository = SessionRepository()
    state = repository.create()
    state.last_active_at = datetime(2026, 8, 20, tzinfo=UTC)
    assert repository.evict_inactive(datetime(2026, 8, 21, 0, 0, 1, tzinfo=UTC)) == 1


def test_v1_operation_ids_are_explicit_and_unique() -> None:
    schema = create_app().openapi()
    operations = [
        operation["operationId"]
        for path in schema["paths"].values()
        for method, operation in path.items()
        if method in {"get", "post", "put", "delete"}
        and operation["operationId"].endswith("Session")
    ]
    assert operations == ["createSession", "deleteSession"]
    assert len(operations) == len(set(operations))
    first = json.dumps(schema, sort_keys=True, separators=(",", ":"))
    second = json.dumps(create_app().openapi(), sort_keys=True, separators=(",", ":"))
    assert first == second


def test_complete_v1_fixture_flow_and_ordered_sse() -> None:
    client = TestClient(create_app())
    session_id = client.post("/api/v1/sessions").json()["session_id"]
    headers = {"X-AGCC-Session": session_id}
    created = client.post("/api/v1/scenario", json=scenario_payload(), headers=headers)
    assert created.status_code == 200
    passes = client.post("/api/v1/passes/compute", headers=headers)
    assert passes.status_code == 200
    assert len(passes.json()) > 0
    plan = client.post(
        "/api/v1/plan", json={"plan_id": "plan_v1fixture001"}, headers=headers
    )
    assert plan.status_code == 200, plan.text
    assert plan.json()["status"] == "feasible"
    started = client.post(
        "/api/v1/simulation/start",
        json={"plan_id": plan.json()["plan_id"]},
        headers=headers,
    )
    assert started.status_code == 200
    preflight = started.json()["preflight"]
    assert preflight["capacity_policy"] == "frozen"
    assert preflight["weather_frozen"] is True
    assert preflight["feasible"] is True
    assert preflight["ledger_allocated_mb"] == started.json()["required_mb"]
    assert started.json()["predicted_shortfall_mb"] == 0.0
    stream = client.get("/api/v1/events/stream", headers=headers)
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    ids = [
        int(line.removeprefix("id: "))
        for line in stream.text.splitlines()
        if line.startswith("id: ")
    ]
    assert ids == sorted(ids)
    assert len(ids) == len(set(ids))


def test_simulation_can_start_paused_without_advancing() -> None:
    client = TestClient(create_app())
    session_id = client.post("/api/v1/sessions").json()["session_id"]
    headers = {"X-AGCC-Session": session_id}
    assert client.post(
        "/api/v1/scenario", json=scenario_payload(), headers=headers
    ).status_code == 200
    assert client.post("/api/v1/passes/compute", headers=headers).status_code == 200
    plan = client.post(
        "/api/v1/plan", json={"plan_id": "plan_pausedstart01"}, headers=headers
    ).json()
    started = client.post(
        "/api/v1/simulation/start",
        json={"plan_id": plan["plan_id"], "speed": "paused"},
        headers=headers,
    )
    assert started.status_code == 200, started.text
    first = started.json()
    second = client.get("/api/v1/simulation/state", headers=headers).json()
    assert first["paused"] is True
    assert second["paused"] is True
    assert second["sim_time"] == first["sim_time"]


def test_simulation_fork_restores_an_isolated_prediction_snapshot() -> None:
    client = TestClient(create_app())
    session_id = client.post("/api/v1/sessions").json()["session_id"]
    headers = {"X-AGCC-Session": session_id}
    assert client.post(
        "/api/v1/scenario", json=scenario_payload(), headers=headers
    ).status_code == 200
    assert client.post("/api/v1/passes/compute", headers=headers).status_code == 200
    plan = client.post(
        "/api/v1/plan", json={"plan_id": "plan_forksnapshot01"}, headers=headers
    ).json()
    started = client.post(
        "/api/v1/simulation/start",
        json={"plan_id": plan["plan_id"], "speed": "paused"},
        headers=headers,
    ).json()

    forked = client.post(
        "/api/v1/simulation/fork",
        json={"sim_time": started["sim_time"], "delivered_mb": 0.5},
        headers=headers,
    )

    assert forked.status_code == 200, forked.text
    assert forked.json()["paused"] is True
    assert forked.json()["sim_time"] == started["sim_time"]
    assert forked.json()["delivered_mb"] == 0.5


def test_live_policy_is_explicitly_dynamic_not_frozen() -> None:
    client = TestClient(create_app())
    session_id = client.post("/api/v1/sessions").json()["session_id"]
    headers = {"X-AGCC-Session": session_id}
    assert client.post(
        "/api/v1/scenario", json=scenario_payload(), headers=headers
    ).status_code == 200
    assert client.post("/api/v1/passes/compute", headers=headers).status_code == 200
    plan = client.post(
        "/api/v1/plan", json={"plan_id": "plan_livepolicy001"}, headers=headers
    ).json()
    started = client.post(
        "/api/v1/simulation/start",
        json={
            "plan_id": plan["plan_id"],
            "speed": "paused",
            "capacity_policy": "live",
        },
        headers=headers,
    )
    assert started.status_code == 200, started.text
    assert started.json()["preflight"]["capacity_policy"] == "live"
    assert started.json()["preflight"]["weather_frozen"] is False
