import datetime as dt
import glob
import io
import json
import os
from pathlib import Path

import psycopg

from app.ai.audio import build_tracks, estimate_start
from app.ai.providers import PipelineError
from app.worker import process_one
from tests.conftest import ADMIN_URL
from tests.fakes import FakeLLM, FakeTranscriber, note
from tests.test_practice import _client, _session
from tests.test_video import AUDIO, _consent_both, _room, _key

REC = Path(os.environ["RECORDINGS_DIR"])
FIXTURE = sorted(glob.glob(str(Path(__file__).parent / "fixtures/client_recording/*.chunk")))


def _recorded_session(api, h, client_offset_s=3.0, real_audio=False):
    c = _client(api, h, name="Asha Kulkarni")
    s = _session(api, h, c["id"])
    key = _key(_room(api, h, s["id"]))
    _consent_both(api, h, s, key)
    t_chunks = [open(f, "rb").read() for f in FIXTURE] if real_audio else [b"T" * 50, b"T" * 50]
    c_chunks = [open(f, "rb").read() for f in FIXTURE] if real_audio else [b"C" * 50, b"C" * 50]
    for i, data in enumerate(t_chunks):
        api.put(f"/api/sessions/{s['id']}/recording/seg-therap1/{i}", content=data, headers={**h, **AUDIO})
    for i, data in enumerate(c_chunks):
        api.put(f"/api/join/{key}/recording/seg-client01/{i}", content=data, headers=AUDIO)
    # pin received_at so alignment is deterministic
    base = dt.datetime(2026, 10, 13, 18, 30, tzinfo=dt.timezone.utc)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        for speaker, start in (("therapist", base), ("client", base + dt.timedelta(seconds=client_offset_s))):
            conn.execute(
                "UPDATE recording_chunks SET received_at = %s + (seq + 1) * interval '5 seconds' "
                "WHERE session_id = %s AND speaker = %s", (start, s["id"], speaker))
    return s, key


def _notes(api, h, sid):
    r = api.get(f"/api/sessions/{sid}/notes", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


GOOD = note(
    subjective=[{"text": "Client reports poor sleep this week.", "lines": [2]}],
    objective=[{"text": "Therapist introduced a thought record.", "lines": [3]}],
    assessment=[{"text": "Sleep difficulties appear linked to work stress.", "lines": [2, 4]}],
    plan=[{"text": "Client will complete one thought record before next session.", "lines": [5]}],
)


def test_marking_done_queues_job_and_worker_produces_aligned_transcript_and_note(api, alice):
    s, _ = _recorded_session(api, alice, client_offset_s=3.0)
    state = api.post(f"/api/sessions/{s['id']}/complete", headers=alice).json()
    assert state["sessions"][0]["notesStatus"] == "processing"

    # client track started 3s after the therapist's
    transcriber = FakeTranscriber(
        [(0.5, 2.0, "How has your week been?"), (6.0, 8.0, "Let's try a thought record.")],          # therapist
        [(0.0, 2.5, "I haven't been sleeping well."), (8.0, 9.0, "Work has been really stressful."),  # client
         (12.0, 13.0, "I'll try one before next week.")],
    )
    llm = FakeLLM(GOOD)
    assert process_one(transcriber, llm) is True
    assert process_one(transcriber, llm) is False  # queue now empty

    out = _notes(api, alice, s["id"])
    assert out["status"] == "draft" and out["job"]["status"] == "done"
    lines = [(l["speaker"], l["startMs"], l["text"]) for l in out["transcript"]]
    assert lines == [
        ("therapist", 500, "How has your week been?"),
        ("client", 3000, "I haven't been sleeping well."),
        ("therapist", 6000, "Let's try a thought record."),
        ("client", 11000, "Work has been really stressful."),
        ("client", 15000, "I'll try one before next week."),
    ]
    assert "L2 [00:03] Client: I haven't been sleeping well." in llm.prompts[0][1]
    ids = [l["id"] for l in out["transcript"]]
    sec = out["note"]["sections"]
    assert sec["subjective"][0]["segmentIds"] == [ids[1]] and sec["plan"][0]["segmentIds"] == [ids[4]]
    assert sec["assessment"][0]["segmentIds"] == [ids[1], ids[3]]
    assert all(st["supported"] for v in sec.values() for st in v)
    assert not out["hasAudio"] and not (REC / "1" / str(s["id"])).exists()


def test_uncited_or_invented_citations_are_flagged_not_hidden(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    llm = FakeLLM(note(subjective=[{"text": "Client reports poor sleep.", "lines": [1]},
                                   {"text": "Client mentioned a new medication.", "lines": [99]},
                                   {"text": "Client feels hopeful.", "lines": []}]))
    process_one(FakeTranscriber([(0, 1, "Hello.")], [(0, 1, "I can't sleep.")]), llm)
    sub = _notes(api, alice, s["id"])["note"]["sections"]["subjective"]
    assert [st["supported"] for st in sub] == [True, False, False]


def test_risk_flags_are_kept_with_citations(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    llm = FakeLLM(note(subjective=[{"text": "Client reports low mood.", "lines": [2]}],
                       risk_flags=[{"text": "Client said they sometimes feel there's no point going on.", "lines": [2]}]))
    process_one(FakeTranscriber([(0, 1, "How are you?")], [(0, 1, "Sometimes I feel there's no point going on.")]), llm)
    flags = _notes(api, alice, s["id"])["note"]["riskFlags"]
    assert len(flags) == 1 and flags[0]["supported"]


def test_malformed_model_reply_is_retried_once(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    llm = FakeLLM("Sure! Here's the note:", "```json\n" + json.dumps(GOOD) + "\n```")
    process_one(FakeTranscriber([(0, 1, "a")], [(0, 1, "b"), (2, 3, "c"), (4, 5, "d"), (6, 7, "e")]), llm)
    assert _notes(api, alice, s["id"])["status"] == "draft" and len(llm.prompts) == 2
    assert "not valid JSON" in llm.prompts[1][1]


def test_llm_failure_keeps_transcript_and_retry_skips_transcription(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)

    class DownLLM:
        name = "down"
        def complete_json(self, system, user):
            raise PipelineError("Can't reach Ollama at http://host.docker.internal:11434. Is the Ollama app running?")

    process_one(FakeTranscriber([(0, 1, "Hi.")], [(0, 1, "Hello.")]), DownLLM())
    out = _notes(api, alice, s["id"])
    assert out["status"] == "failed" and "Ollama" in out["job"]["error"]
    assert len(out["transcript"]) == 2 and out["note"] is None

    retry = api.post(f"/api/sessions/{s['id']}/notes/generate", headers=alice).json()
    assert retry["status"] == "processing"
    transcriber = FakeTranscriber()
    process_one(transcriber, FakeLLM(note(plan=[{"text": "Follow up.", "lines": [1]}])))
    assert transcriber.calls == []  # only re-drafts
    assert _notes(api, alice, s["id"])["status"] == "draft"


def test_session_with_no_recording_gets_no_job(api, alice):
    c = _client(api, alice)
    s = _session(api, alice, c["id"])
    state = api.post(f"/api/sessions/{s['id']}/complete", headers=alice).json()
    assert state["sessions"][0]["notesStatus"] == "none"
    assert api.post(f"/api/sessions/{s['id']}/notes/generate", headers=alice).status_code == 422


def test_generate_twice_does_not_queue_two_jobs(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    api.post(f"/api/sessions/{s['id']}/notes/generate", headers=alice)
    api.post(f"/api/sessions/{s['id']}/notes/generate", headers=alice)
    with psycopg.connect(ADMIN_URL) as conn:
        assert conn.execute("SELECT count(*) FROM processing_jobs").fetchone()[0] == 1


def test_edit_approve_reopen_and_approved_note_is_never_overwritten(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    process_one(FakeTranscriber([(0, 1, "a")], [(0, 1, "b"), (2, 3, "c"), (4, 5, "d"), (6, 7, "e")]), FakeLLM(GOOD))
    out = _notes(api, alice, s["id"])
    sections = out["note"]["sections"]
    sections["plan"].append({"id": "t1", "text": "Therapist to share sleep hygiene handout.", "segmentIds": [], "supported": True})
    sections["subjective"][0]["segmentIds"].append(999999)
    saved = api.put(f"/api/sessions/{s['id']}/notes", json={"sections": sections, "riskFlags": []}, headers=alice).json()
    assert saved["note"]["sections"]["plan"][-1]["text"].startswith("Therapist to share")
    assert 999999 not in saved["note"]["sections"]["subjective"][0]["segmentIds"]

    approved = api.post(f"/api/sessions/{s['id']}/notes/approve", headers=alice).json()
    assert approved["status"] == "approved" and approved["note"]["approvedAt"]
    assert api.post(f"/api/sessions/{s['id']}/notes/generate", headers=alice).status_code == 409

    reopened = api.post(f"/api/sessions/{s['id']}/notes/reopen", headers=alice).json()
    assert reopened["status"] == "draft" and reopened["note"]["approvedAt"] is None


def test_long_transcript_is_drafted_in_parts_then_merged(api, alice, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "note_chunk_tokens", 40)  # ~160 chars per part
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    therapist = [(i * 10.0, i * 10 + 4.0, f"Therapist sentence number {i} about the week.") for i in range(6)]
    client = [(i * 10.0 + 5, i * 10 + 9.0, f"Client sentence number {i} about work and sleep.") for i in range(6)]
    class CountingLLM(FakeLLM):
        def complete_json(self, system, user):
            self.prompts.append((system, user))
            if "Partial drafts" in user:
                return json.dumps(note(subjective=[{"text": "Merged statement.", "lines": [1, 12]}]))
            return json.dumps(note(subjective=[{"text": "Part statement.", "lines": [1]}]))
    llm = CountingLLM()
    process_one(FakeTranscriber(therapist, client), llm)
    drafting = [p for p in llm.prompts if "Partial drafts" not in p[1]]
    assert len(drafting) >= 3 and "Partial drafts" in llm.prompts[-1][1]
    assert "L12 [" in drafting[-1][1]
    sub = _notes(api, alice, s["id"])["note"]["sections"]["subjective"]
    assert sub[0]["text"] == "Merged statement." and len(sub[0]["segmentIds"]) == 2


def test_worker_serves_every_therapist_but_keeps_their_data_apart(api, alice, bob):
    sa, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{sa['id']}/complete", headers=alice)
    c = _client(api, bob, name="Ravi Iyer")
    sb = _session(api, bob, c["id"])
    kb = _key(_room(api, bob, sb["id"]))
    _consent_both(api, bob, sb, kb)
    api.put(f"/api/join/{kb}/recording/seg-client02/0", content=b"R" * 50, headers=AUDIO)
    api.post(f"/api/sessions/{sb['id']}/complete", headers=bob)

    process_one(FakeTranscriber([(0, 1, "Alice's therapist line.")], [(0, 1, "Asha's line.")]),
                FakeLLM(note(plan=[{"text": "A plan.", "lines": [1]}])))
    process_one(FakeTranscriber([(0, 1, "Ravi's line.")]), FakeLLM(note(plan=[{"text": "B plan.", "lines": [1]}])))

    a, b = _notes(api, alice, sa["id"]), _notes(api, bob, sb["id"])
    assert [l["text"] for l in a["transcript"]] == ["Alice's therapist line.", "Asha's line."]
    assert [l["text"] for l in b["transcript"]] == ["Ravi's line."]
    assert api.get(f"/api/sessions/{sa['id']}/notes", headers=bob).status_code == 404
    assert api.put(f"/api/sessions/{sa['id']}/notes", json={"sections": {}, "riskFlags": []}, headers=bob).status_code == 404
    assert api.post(f"/api/sessions/{sa['id']}/notes/approve", headers=bob).status_code == 404


def test_stale_running_job_is_reclaimed(api, alice):
    s, _ = _recorded_session(api, alice)
    api.post(f"/api/sessions/{s['id']}/complete", headers=alice)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:  # worker died mid-job
        conn.execute("UPDATE processing_jobs SET status='running', attempts=1, heartbeat_at=now() - interval '1 hour'")
    process_one(FakeTranscriber([(0, 1, "a")], [(0, 1, "b"), (2, 3, "c"), (4, 5, "d"), (6, 7, "e")]), FakeLLM(GOOD))
    assert _notes(api, alice, s["id"])["status"] == "draft"


def test_real_recorded_chunks_stitch_into_decodable_audio(tmp_path):
    # fixture = real chunks recorded from a browser call
    from faster_whisper.audio import decode_audio
    seg = tmp_path / "client" / "seg-real"
    seg.mkdir(parents=True)
    t0 = dt.datetime(2026, 10, 13, 12, 0, tzinfo=dt.timezone.utc)
    rows = []
    for i, f in enumerate(FIXTURE):
        (seg / f"{i:06d}.chunk").write_bytes(open(f, "rb").read())
        rows.append(type("R", (), dict(speaker="client", segment="seg-real", seq=i, mime_type="audio/webm",
                                       received_at=t0 + dt.timedelta(seconds=5 * (i + 1) + 0.3))))
    [track] = build_tracks(rows, tmp_path)
    assert track.started_at == t0 + dt.timedelta(seconds=0.3)
    samples = decode_audio(io.BytesIO(track.audio), sampling_rate=16000)
    assert 25 < len(samples) / 16000 < 28


def test_start_estimate_ignores_late_uploads():
    t0 = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    arrivals = [(0, t0 + dt.timedelta(seconds=9)), (1, t0 + dt.timedelta(seconds=10.2)), (2, t0 + dt.timedelta(seconds=15.1))]
    assert estimate_start(arrivals) == t0 + dt.timedelta(seconds=0.1)
