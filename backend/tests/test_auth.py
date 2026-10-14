def test_login_round_trip(api, alice):
    r = api.post("/api/auth/login", json={"email": "ALICE@example.com", "password": "correct-horse-battery"})
    assert r.status_code == 200
    assert api.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['accessToken']}"}).json()["email"] == "alice@example.com"


def test_wrong_password_and_unknown_email_look_the_same(api, alice):
    a = api.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong-password!"})
    b = api.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password!"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_duplicate_signup_rejected(api, alice):
    r = api.post("/api/auth/signup", json={"email": "alice@example.com", "fullName": "X", "password": "another-long-one"})
    assert r.status_code == 409


def test_requests_without_token_are_rejected(api):
    assert api.get("/api/state").status_code == 401
    assert api.get("/api/state", headers={"Authorization": "Bearer garbage"}).status_code == 401
