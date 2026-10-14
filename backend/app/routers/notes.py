import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..deps import tenant_db
from ..jobs import active_job, enqueue, has_source
from ..models import ProcessingJob, RecordingChunk, Session, SessionNote, TranscriptSegment
from ..schemas import JobOut, NoteIn, NoteOut, NotesOut, TranscriptLineOut
from .practice import notes_statuses

router = APIRouter(prefix="/api/sessions/{session_id}/notes", tags=["notes"])


def _session(db: DbSession, session_id: int) -> Session:
    s = db.scalar(select(Session).where(Session.id == session_id))
    if s is None:
        raise HTTPException(404, "Session not found")
    return s


def _note(db: DbSession, session_id: int, *, lock: bool = False) -> SessionNote | None:
    stmt = select(SessionNote).where(SessionNote.session_id == session_id)
    return db.scalar(stmt.with_for_update() if lock else stmt)


def _out(db: DbSession, s: Session) -> NotesOut:
    db.flush()
    job = db.scalar(select(ProcessingJob).where(ProcessingJob.session_id == s.id)
                    .order_by(ProcessingJob.created_at.desc(), ProcessingJob.id.desc()).limit(1))
    note = _note(db, s.id)
    lines = db.scalars(select(TranscriptSegment).where(TranscriptSegment.session_id == s.id)
                       .order_by(TranscriptSegment.start_ms, TranscriptSegment.id)).all()
    return NotesOut(
        status=notes_statuses(db, [s.id]).get(s.id, "none"),
        job=JobOut.model_validate(job) if job else None,
        transcript=[TranscriptLineOut.model_validate(l) for l in lines],
        note=NoteOut(format=note.format, status=note.status, sections=note.content["sections"],
                     risk_flags=note.content.get("riskFlags", []), model=note.model,
                     approved_at=note.approved_at, updated_at=note.updated_at) if note else None,
        has_audio=db.scalar(select(RecordingChunk.id).where(RecordingChunk.session_id == s.id).limit(1)) is not None,
    )


@router.get("", response_model=NotesOut)
def get_notes(session_id: int, db: DbSession = Depends(tenant_db)):
    return _out(db, _session(db, session_id))


@router.post("/generate", response_model=NotesOut)
def generate(session_id: int, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id)
    db.scalar(select(Session.id).where(Session.id == s.id).with_for_update())  # double-click guard
    if active_job(db, s.id):
        return _out(db, s)
    note = _note(db, s.id)
    if note and note.status == "approved":
        raise HTTPException(409, "This note is approved. Reopen it for editing before generating a new draft.")
    if not has_source(db, s.id):
        raise HTTPException(422, "There's no recording or transcript for this session yet.")
    enqueue(db, s.therapist_id, s.id)
    return _out(db, s)


@router.put("", response_model=NotesOut)
def save_note(session_id: int, body: NoteIn, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id)
    note = _note(db, s.id, lock=True)
    if note is None:
        raise HTTPException(404, "There's no note to edit yet")
    valid = set(db.scalars(select(TranscriptSegment.id).where(TranscriptSegment.session_id == s.id)))
    def clean(items):
        return [{**i.model_dump(by_alias=True), "segmentIds": [x for x in i.segment_ids if x in valid],
                 "supported": i.supported and any(x in valid for x in i.segment_ids) if i.segment_ids else i.supported}
                for i in items]
    sections = {k: clean(getattr(body.sections, k)) for k in ("subjective", "objective", "assessment", "plan")}
    note.content = {**note.content, "sections": sections, "riskFlags": clean(body.risk_flags), "edited": True}
    note.status, note.approved_at, note.updated_at = "draft", None, dt.datetime.now(dt.timezone.utc)
    return _out(db, s)


@router.post("/approve", response_model=NotesOut)
def approve(session_id: int, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id)
    note = _note(db, s.id, lock=True)
    if note is None:
        raise HTTPException(404, "There's no note to approve yet")
    note.status, note.approved_at = "approved", dt.datetime.now(dt.timezone.utc)
    return _out(db, s)


@router.post("/reopen", response_model=NotesOut)
def reopen(session_id: int, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id)
    note = _note(db, s.id, lock=True)
    if note is None:
        raise HTTPException(404, "There's no note yet")
    note.status, note.approved_at = "draft", None
    return _out(db, s)
