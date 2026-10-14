from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import exists, select, text
from sqlalchemy.orm import Session as DbSession

from .db import SessionLocal
from .models import ProcessingJob, RecordingChunk, TranscriptSegment

ACTIVE = ("queued", "running")


def active_job(db: DbSession, session_id: int) -> ProcessingJob | None:
    return db.scalar(select(ProcessingJob).where(ProcessingJob.session_id == session_id, ProcessingJob.status.in_(ACTIVE)))


def has_source(db: DbSession, session_id: int) -> bool:
    # audio to transcribe, or an existing transcript to re-draft from
    return bool(db.scalar(select(
        exists().where(RecordingChunk.session_id == session_id)
        | exists().where(TranscriptSegment.session_id == session_id)
    )))


def enqueue(db: DbSession, therapist_id: int, session_id: int) -> ProcessingJob:
    job = active_job(db, session_id)
    if job is None:
        job = ProcessingJob(therapist_id=therapist_id, session_id=session_id)
        db.add(job)
        db.flush()
    return job


@contextmanager
def tenant_tx(therapist_id: int) -> Iterator[DbSession]:
    with SessionLocal() as db, db.begin():
        db.execute(text("SELECT set_config('app.therapist_id', :tid, true)"), {"tid": str(therapist_id)})
        yield db
