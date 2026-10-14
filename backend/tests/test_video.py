import os
from pathlib import Path

import jwt

from tests.test_practice import _client, _session

AUDIO = {"Content-Type": "audio/webm;codecs=opus"}
REC = Path(os.environ["RECORDINGS_DIR"])


def _room(api, h, session_id):
    r = api.post(f"/api/sessions/{session_id}/room", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _key(room):
    return room["clientJoinUrl"].rsplit("/join/", 1)[1]


def _setup(api, h):
    c = _client(api, h, name="Asha Kulkarni")
    s = _session(api, h, c["id"])
    room = _room(api, h, s["id"])
    return s, room, _key(room)


def _consent_both(api, h, s, key):
    api.post(f"/api/sessions/{s['id']}/consent", json={"consent": True}, headers=h)
    return api.post(f"/api/join/{key}/consent", json={"consent": True}).json()


def test_tokens_identify_each_side_in_the_same_room(api, alice):
    s, room, key = _setup(api, alice)
    t = jwt.decode(room["token"], os.environ["LIVEKIT_API_SECRET"], algorithms=["HS256"])
    c = jwt.decode(api.post(f"/api/join/{key}/room").json()["token"], os.environ["LIVEKIT_API_SECRET"], algorithms=["HS256"])
    assert (t["sub"], c["sub"]) == ("therapist", "client")
    assert t["video"]["room"] == c["video"]["room"] and t["video"]["roomJoin"]
    assert t["name"] == "Dr Test" and c["name"] == "Asha"


def test_join_info_shows_only_what_the_client_needs(api, alice):
    s, room, key = _setup(api, alice)
    info = api.get(f"/api/join/{key}").json()
    assert info["therapistName"] == "Dr Test" and info["clientFirstName"] == "Asha" and info["time"] == "18:30"
    assert "email" not in str(info) and "notes" not in info


def test_forged_and_rotated_links_are_rejected(api, alice):
    s, room, key = _setup(api, alice)
    sid = key.split(".")[0]
    for bad in [f"{sid}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", f"{int(sid) + 1}.{key.split('.')[1]}", "garbage", "1"]:
        assert api.get(f"/api/join/{bad}").status_code == 404
    new = api.post(f"/api/sessions/{s['id']}/client-link?rotate=true", headers=alice).json()["clientJoinUrl"]
    assert api.get(f"/api/join/{key}").status_code == 404
    assert api.get(f"/api/join/{new.rsplit('/', 1)[1]}").status_code == 200


def test_link_is_stable_until_rotated(api, alice):
    s, room, key = _setup(api, alice)
    again = api.post(f"/api/sessions/{s['id']}/client-link", headers=alice).json()["clientJoinUrl"]
    assert again == room["clientJoinUrl"]


def test_recording_needs_both_consents(api, alice):
    s, room, key = _setup(api, alice)
    url = f"/api/sessions/{s['id']}/recording/seg-00000001/0"
    assert api.put(url, content=b"x" * 100, headers={**alice, **AUDIO}).status_code == 409
    api.post(f"/api/sessions/{s['id']}/consent", json={"consent": True}, headers=alice)
    assert api.put(url, content=b"x" * 100, headers={**alice, **AUDIO}).status_code == 409
    status = api.post(f"/api/join/{key}/consent", json={"consent": True}).json()
    assert status["recording"]
    assert api.put(url, content=b"x" * 100, headers={**alice, **AUDIO}).status_code == 200


def test_chunks_are_stored_per_speaker_and_retries_are_idempotent(api, alice):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    assert api.put(f"/api/sessions/{s['id']}/recording/seg-therap1/0", content=b"T" * 10, headers={**alice, **AUDIO}).json()["stored"]
    assert not api.put(f"/api/sessions/{s['id']}/recording/seg-therap1/0", content=b"T" * 10, headers={**alice, **AUDIO}).json()["stored"]
    out = api.put(f"/api/join/{key}/recording/seg-client01/0", content=b"C" * 20, headers=AUDIO).json()
    assert out["status"]["chunks"] == {"therapist": {"count": 1, "bytes": 10}, "client": {"count": 1, "bytes": 20}}
    base = REC / "1" / str(s["id"])
    assert (base / "therapist" / "seg-therap1" / "000000.chunk").read_bytes() == b"T" * 10
    assert (base / "client" / "seg-client01" / "000000.chunk").read_bytes() == b"C" * 20


def test_upload_validation(api, alice):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    base = f"/api/join/{key}/recording"
    assert api.put(f"{base}/seg-client01/0", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    assert api.put(f"{base}/../../etc/0", content=b"x", headers=AUDIO).status_code in (404, 422)
    assert api.put(f"{base}/short/0", content=b"x", headers=AUDIO).status_code == 422
    assert api.put(f"{base}/seg-client01/0", content=b"x" * (5 * 1024 * 1024 + 1), headers=AUDIO).status_code == 413
    assert api.put(f"{base}/seg-client01/0", content=b"", headers=AUDIO).status_code in (413, 422)


def test_withdrawing_consent_stops_and_deletes_recording(api, alice):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    api.put(f"/api/join/{key}/recording/seg-client01/0", content=b"C" * 20, headers=AUDIO)
    status = api.post(f"/api/join/{key}/consent", json={"consent": False}).json()
    assert not status["recording"] and status["chunks"]["client"]["count"] == 0
    assert not (REC / "1" / str(s["id"])).exists()
    assert api.put(f"/api/sessions/{s['id']}/recording/seg-therap1/0", content=b"T", headers={**alice, **AUDIO}).status_code == 409


def test_completed_session_closes_the_room(api, alice):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    assert api.post(f"/api/join/{key}/room").status_code == 410
    assert api.put(f"/api/join/{key}/recording/seg-client01/0", content=b"C", headers=AUDIO).status_code == 410
    assert api.post(f"/api/sessions/{s['id']}/room", headers=alice).status_code == 409


def test_deleting_session_removes_audio_files(api, alice):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    api.put(f"/api/join/{key}/recording/seg-client01/0", content=b"C", headers=AUDIO)
    assert (REC / "1" / str(s["id"])).exists()
    api.delete(f"/api/sessions/{s['id']}", headers=alice)
    assert not (REC / "1" / str(s["id"])).exists()


def test_other_therapist_cannot_reach_room_or_recording(api, alice, bob):
    s, room, key = _setup(api, alice)
    _consent_both(api, alice, s, key)
    assert api.post(f"/api/sessions/{s['id']}/room", headers=bob).status_code == 404
    assert api.post(f"/api/sessions/{s['id']}/client-link", headers=bob).status_code == 404
    assert api.get(f"/api/sessions/{s['id']}/recording", headers=bob).status_code == 404
    assert api.post(f"/api/sessions/{s['id']}/consent", json={"consent": False}, headers=bob).status_code == 404
    assert api.put(f"/api/sessions/{s['id']}/recording/seg-therap1/0", content=b"x", headers={**bob, **AUDIO}).status_code == 404
