# recording -> transcript -> draft note.  run: python -m app.worker
# jobs are claimed via claim_next_job() (SKIP LOCKED) so multiple workers are fine. slow steps run
# outside transactions; heartbeat lets a dead worker's job get picked up again.
import datetime as dt
import logging
import shutil
import time
from pathlib import Path

from sqlalchemy import delete, select, text, update

from .ai.audio import build_tracks
from .ai.notes import Line, draft_note
from .ai.providers import LLM, PipelineError, Transcriber, get_llm, get_transcriber
from .config import get_settings
from .db import SessionLocal
from .jobs import tenant_tx
from .models import ProcessingJob, RecordingChunk, SessionNote, TranscriptSegment

log = logging.getLogger("worker")
MAX_ATTEMPTS = 3


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _set(tid: int, job_id: int, **fields) -> None:
    with tenant_tx(tid) as db:
        db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id).values(heartbeat_at=_now(), **fields))


def _transcribe(tid: int, job_id: int, session_id: int, transcriber: Transcriber) -> None:
    s = get_settings()
    session_dir = Path(s.recordings_dir) / str(tid) / str(session_id)
    with tenant_tx(tid) as db:
        rows = db.scalars(select(RecordingChunk).where(RecordingChunk.session_id == session_id)).all()
    tracks = build_tracks(rows, session_dir)
    if not tracks:
        raise PipelineError("No usable audio was recorded for this session.")

    t0 = tracks[0].started_at
    lines = []
    for track in tracks:
        offset_ms = int((track.started_at - t0).total_seconds() * 1000)
        for u in transcriber.transcribe(track.audio, track.mime):
            lines.append((track.speaker, offset_ms + int(u.start * 1000), offset_ms + int(u.end * 1000), u.text))
        _set(tid, job_id)  # heartbeat
    if not lines:
        raise PipelineError("No speech was detected in the recording.")
    lines.sort(key=lambda l: (l[1], l[0]))

    with tenant_tx(tid) as db:
        db.execute(delete(TranscriptSegment).where(TranscriptSegment.session_id == session_id))
        db.add_all([TranscriptSegment(therapist_id=tid, session_id=session_id, speaker=sp, start_ms=a, end_ms=b, text=t)
                    for sp, a, b, t in lines])
        if s.delete_audio_after_transcription:
            db.execute(delete(RecordingChunk).where(RecordingChunk.session_id == session_id))
            shutil.rmtree(session_dir, ignore_errors=True)


def run_job(job_id: int, tid: int, session_id: int, attempts: int, transcriber: Transcriber, llm: LLM) -> None:
    if attempts > MAX_ATTEMPTS:
        raise PipelineError(f"Gave up after {MAX_ATTEMPTS} attempts. Check the worker logs, then try again.")
    with tenant_tx(tid) as db:
        has_audio = db.scalar(select(RecordingChunk.id).where(RecordingChunk.session_id == session_id).limit(1)) is not None

    if has_audio:
        _set(tid, job_id, stage="transcribing")
        _transcribe(tid, job_id, session_id, transcriber)

    with tenant_tx(tid) as db:
        segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.session_id == session_id)
                          .order_by(TranscriptSegment.start_ms, TranscriptSegment.id)).all()
        lines = [Line(s.id, s.speaker, s.start_ms, s.text) for s in segs]
    if not lines:
        raise PipelineError("No audio was recorded for this session.")

    _set(tid, job_id, stage="drafting")
    content = draft_note(lines, llm, get_settings().note_chunk_tokens)

    with tenant_tx(tid) as db:
        note = db.scalar(select(SessionNote).where(SessionNote.session_id == session_id).with_for_update())
        if note is None:
            db.add(SessionNote(therapist_id=tid, session_id=session_id, content=content, model=llm.name))
        elif note.status != "approved":  # don't clobber an approved note
            note.content, note.model, note.status, note.updated_at = content, llm.name, "draft", _now()
        db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id)
                   .values(status="done", stage="finished", finished_at=_now(), heartbeat_at=_now()))


_providers: dict = {}


def _default_providers() -> tuple[Transcriber, LLM]:
    # cached so the whisper model only loads once
    if not _providers:
        _providers["t"], _providers["l"] = get_transcriber(), get_llm()
    return _providers["t"], _providers["l"]


def process_one(transcriber: Transcriber | None = None, llm: LLM | None = None) -> bool:
    with SessionLocal() as db, db.begin():
        row = db.execute(text("SELECT * FROM claim_next_job()")).first()
    if row is None:
        return False
    job_id, tid, session_id, attempts = row
    log.info("job %s (session %s): starting, attempt %s", job_id, session_id, attempts)
    try:
        if transcriber is None or llm is None:
            transcriber, llm = _default_providers()  # bad config -> this job fails with the message
        run_job(job_id, tid, session_id, attempts, transcriber, llm)
        log.info("job %s: done", job_id)
    except PipelineError as exc:
        log.warning("job %s failed: %s", job_id, exc)
        _set(tid, job_id, status="failed", error=str(exc), finished_at=_now())
    except Exception:
        log.exception("job %s crashed", job_id)
        _set(tid, job_id, status="failed", error="Something went wrong while processing. Check the worker logs.", finished_at=_now())
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    log.info("worker started: transcription=%s, llm=%s", s.transcription_provider, s.llm_provider)
    while True:
        try:
            if not process_one():
                time.sleep(2)
        except Exception:
            log.exception("worker loop error")
            time.sleep(5)

if __name__ == "__main__":
    main()
