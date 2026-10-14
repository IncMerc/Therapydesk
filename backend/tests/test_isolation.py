import os

import psycopg
import pytest

from tests.test_practice import _client, _session

APP_URL = os.environ["DATABASE_URL"].replace("+psycopg", "")


def test_api_hides_other_therapists_data(api, alice, bob):
    c = _client(api, alice)
    s = _session(api, alice, c["id"])

    assert api.get("/api/state", headers=bob).json()["clients"] == []
    assert api.patch(f"/api/clients/{c['id']}", json={"name": "pwned"}, headers=bob).status_code == 404
    assert api.delete(f"/api/clients/{c['id']}", headers=bob).status_code == 404
    assert api.post(f"/api/sessions/{s['id']}/complete", headers=bob).status_code == 404
    assert api.post("/api/sessions", json={"clientId": c["id"], "date": "2026-10-20", "time": "10:00"}, headers=bob).status_code == 404
    assert api.post("/api/payments", json={"clientId": c["id"], "amount": 1, "type": "prepaid", "prepaidSessions": 1}, headers=bob).status_code == 404

    alice_state = api.get("/api/state", headers=alice).json()
    assert alice_state["clients"][0]["name"] == "Asha" and alice_state["sessions"][0]["status"] == "scheduled"


def test_db_returns_nothing_when_no_tenant_is_set(api, alice):
    _client(api, alice)
    with psycopg.connect(APP_URL) as conn:
        assert conn.execute("SELECT count(*) FROM clients").fetchone()[0] == 0


def test_db_rejects_writing_rows_for_another_therapist(api, alice, bob):
    _client(api, alice)
    with psycopg.connect(APP_URL) as conn:
        conn.execute("SELECT set_config('app.therapist_id', '2', true)")  # bob
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO clients (therapist_id, name, client_type, rate) VALUES (1, 'x', 'student', 1)")


def test_db_rejects_session_linking_to_another_therapists_client(api, alice, bob):
    c = _client(api, alice)
    with psycopg.connect(APP_URL) as conn:
        conn.execute("SELECT set_config('app.therapist_id', '2', true)")
        with pytest.raises(psycopg.errors.RaiseException):
            conn.execute(
                "INSERT INTO sessions (therapist_id, client_id, date, time, duration) VALUES (2, %s, '2026-10-20', '10:00', 50)",
                (c["id"],),
            )
