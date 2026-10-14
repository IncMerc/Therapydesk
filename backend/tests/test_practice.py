def _client(api, h, **kw):
    body = {"name": "Asha", "clientType": "professional", **kw}
    return api.post("/api/clients", json=body, headers=h).json()["clients"][-1]


def _session(api, h, client_id, date="2026-10-20"):
    r = api.post("/api/sessions", json={"clientId": client_id, "date": date, "time": "18:30"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["sessions"][-1]


def test_rate_is_set_by_server_not_client(api, alice):
    c = _client(api, alice, clientType="student", rate=1)
    assert c["rate"] == 599
    state = api.patch(f"/api/clients/{c['id']}", json={"clientType": "international"}, headers=alice).json()
    assert state["clients"][0]["rate"] == 30


def test_session_time_comes_back_as_hhmm(api, alice):
    s = _session(api, alice, _client(api, alice)["id"])
    assert s["time"] == "18:30" and s["status"] == "scheduled"


def test_complete_without_credits_leaves_balance_then_toggle_payment(api, alice):
    c = _client(api, alice)
    s = _session(api, alice, c["id"])
    state = api.post(f"/api/sessions/{s['id']}/complete", headers=alice).json()
    assert state["sessions"][0]["status"] == "completed" and not state["sessions"][0]["paid"]

    state = api.post(f"/api/sessions/{s['id']}/toggle-payment", headers=alice).json()
    assert state["sessions"][0]["paid"]
    [p] = state["payments"]
    assert p["autoRecorded"] and p["sessionIds"] == [s["id"]] and p["amount"] == 999

    state = api.post(f"/api/sessions/{s['id']}/toggle-payment", headers=alice).json()
    assert not state["sessions"][0]["paid"] and state["payments"] == []


def test_prepaid_credits_are_spent_once_even_on_double_complete(api, alice):
    c = _client(api, alice)
    state = api.post("/api/payments", json={"clientId": c["id"], "amount": 2997, "type": "prepaid", "prepaidSessions": 3}, headers=alice).json()
    assert state["credits"] == {str(c["id"]): 3}

    s = _session(api, alice, c["id"])
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    state = api.post(f"/api/sessions/{s['id']}/complete", headers=alice).json()
    assert state["credits"] == {str(c["id"]): 2}
    assert state["sessions"][0]["prepaid"] and state["sessions"][0]["paid"]
    assert api.post(f"/api/sessions/{s['id']}/toggle-payment", headers=alice).status_code == 409


def test_payment_for_completed_sessions_marks_them_paid(api, alice):
    c = _client(api, alice)
    s1, s2 = _session(api, alice, c["id"]), _session(api, alice, c["id"], "2026-10-27")
    state = api.post("/api/payments", json={"clientId": c["id"], "amount": 1998, "type": "completed", "sessionIds": [s1["id"], s2["id"]]}, headers=alice).json()
    assert all(s["paid"] for s in state["sessions"])


def test_payment_cannot_cover_another_clients_session(api, alice):
    c1, c2 = _client(api, alice), _client(api, alice, name="Ravi")
    s = _session(api, alice, c2["id"])
    r = api.post("/api/payments", json={"clientId": c1["id"], "amount": 999, "type": "completed", "sessionIds": [s["id"]]}, headers=alice)
    assert r.status_code == 422


def test_delete_client_cascades(api, alice):
    c = _client(api, alice)
    s = _session(api, alice, c["id"])
    api.post(f"/api/sessions/{s['id']}/toggle-payment", headers=alice)
    state = api.delete(f"/api/clients/{c['id']}", headers=alice).json()
    assert state["clients"] == state["sessions"] == state["payments"] == []


def test_meet_link_must_be_https(api, alice):
    c = _client(api, alice)
    assert api.put(f"/api/clients/{c['id']}/meet-link", json={"meetLink": "javascript:alert(1)"}, headers=alice).status_code == 422
    state = api.put(f"/api/clients/{c['id']}/meet-link", json={"meetLink": "https://meet.google.com/abc-defg-hij"}, headers=alice).json()
    assert state["meetLinks"] == {str(c["id"]): "https://meet.google.com/abc-defg-hij"}
