# every mutation returns the full state so the frontend just replaces what it has
import shutil
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..deps import tenant_db
from ..jobs import enqueue
from ..models import Client, Payment, ProcessingJob, RecordingChunk, Session, SessionNote, TranscriptSegment
from ..schemas import (
    CLIENT_RATES, ClientIn, ClientOut, ClientPatch, MeetLinkIn, PaymentIn, PaymentOut,
    SessionIn, SessionOut, SessionPatch, StateOut,
)

router = APIRouter(prefix="/api", tags=["practice"])


def notes_statuses(db: DbSession, session_ids: list[int] | None = None) -> dict[int, str]:
    def ids(model, *where):
        stmt = select(model.session_id).where(*where).distinct()
        if session_ids is not None:
            stmt = stmt.where(model.session_id.in_(session_ids))
        return set(db.scalars(stmt))

    status: dict[int, str] = {}
    for sid in ids(RecordingChunk) | ids(TranscriptSegment):
        status[sid] = "recorded"
    jobs = select(ProcessingJob.session_id, ProcessingJob.status).order_by(ProcessingJob.created_at, ProcessingJob.id)
    if session_ids is not None:
        jobs = jobs.where(ProcessingJob.session_id.in_(session_ids))
    latest = {sid: job_status for sid, job_status in db.execute(jobs)}  # ordered, so last one wins
    for sid, job_status in latest.items():
        if job_status in ("queued", "running"):
            status[sid] = "processing"
        elif job_status == "failed":
            status[sid] = "failed"
    notes = select(SessionNote.session_id, SessionNote.status)
    if session_ids is not None:
        notes = notes.where(SessionNote.session_id.in_(session_ids))
    for sid, note_status in db.execute(notes):
        if status.get(sid) != "processing":
            status[sid] = note_status
    return status


def _state(db: DbSession) -> StateOut:
    db.flush()
    clients = db.scalars(select(Client).order_by(Client.id)).all()
    statuses = notes_statuses(db)
    sessions = []
    for s in db.scalars(select(Session).order_by(Session.date, Session.time)):
        out = SessionOut.model_validate(s)
        out.notes_status = statuses.get(s.id, "none")
        sessions.append(out)
    return StateOut(
        clients=[ClientOut.model_validate(c) for c in clients],
        sessions=sessions,
        payments=[PaymentOut.model_validate(p) for p in db.scalars(select(Payment).order_by(Payment.id))],
        credits={c.id: c.prepaid_credits for c in clients if c.prepaid_credits},
        meet_links={c.id: c.meet_link for c in clients if c.meet_link},
    )


def _remove_recordings(therapist_id: int, session_ids: list[int]) -> None:
    # rows cascade, files don't
    for sid in session_ids:
        shutil.rmtree(Path(get_settings().recordings_dir) / str(therapist_id) / str(sid), ignore_errors=True)


def _get(db: DbSession, model, obj_id: int, *, lock: bool = False):
    # other therapists' rows are invisible under RLS, so this 404s for them too
    stmt = select(model).where(model.id == obj_id)
    obj = db.scalar(stmt.with_for_update() if lock else stmt)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return obj


@router.get("/state", response_model=StateOut)
def get_state(db: DbSession = Depends(tenant_db)):
    return _state(db)


@router.post("/clients", response_model=StateOut, status_code=201)
def create_client(body: ClientIn, db: DbSession = Depends(tenant_db)):
    db.add(Client(therapist_id=db.info["therapist_id"], rate=CLIENT_RATES[body.client_type], **body.model_dump()))
    return _state(db)


@router.patch("/clients/{client_id}", response_model=StateOut)
def update_client(client_id: int, body: ClientPatch, db: DbSession = Depends(tenant_db)):
    client = _get(db, Client, client_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    if body.client_type is not None:
        client.rate = CLIENT_RATES[body.client_type]
    return _state(db)


@router.put("/clients/{client_id}/meet-link", response_model=StateOut)
def set_meet_link(client_id: int, body: MeetLinkIn, db: DbSession = Depends(tenant_db)):
    link = body.meet_link.strip()
    if link and not link.startswith("https://"):
        raise HTTPException(422, "Meeting link must start with https://")
    _get(db, Client, client_id).meet_link = link
    return _state(db)


@router.delete("/clients/{client_id}", response_model=StateOut)
def delete_client(client_id: int, db: DbSession = Depends(tenant_db)):
    client = _get(db, Client, client_id)
    session_ids = list(db.scalars(select(Session.id).where(Session.client_id == client.id)))
    db.delete(client)
    db.flush()
    _remove_recordings(client.therapist_id, session_ids)
    return _state(db)


@router.post("/sessions", response_model=StateOut, status_code=201)
def create_session(body: SessionIn, db: DbSession = Depends(tenant_db)):
    _get(db, Client, body.client_id)
    db.add(Session(therapist_id=db.info["therapist_id"], **body.model_dump()))
    return _state(db)


@router.patch("/sessions/{session_id}", response_model=StateOut)
def update_session(session_id: int, body: SessionPatch, db: DbSession = Depends(tenant_db)):
    session = _get(db, Session, session_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(session, field, value)
    return _state(db)


@router.post("/sessions/{session_id}/complete", response_model=StateOut)
def complete_session(session_id: int, db: DbSession = Depends(tenant_db)):
    session = _get(db, Session, session_id, lock=True)
    if session.status == "completed":
        return _state(db)  # don't spend a second credit on double-click
    client = _get(db, Client, session.client_id, lock=True)
    session.status = "completed"
    if client.prepaid_credits > 0:
        client.prepaid_credits -= 1
        session.prepaid = session.paid = True
    if db.scalar(select(RecordingChunk.id).where(RecordingChunk.session_id == session.id).limit(1)) is not None:
        enqueue(db, session.therapist_id, session.id)
    return _state(db)


@router.post("/sessions/{session_id}/toggle-payment", response_model=StateOut)
def toggle_session_payment(session_id: int, db: DbSession = Depends(tenant_db)):
    session = _get(db, Session, session_id, lock=True)
    if session.prepaid:
        raise HTTPException(status.HTTP_409_CONFLICT, "Prepaid sessions are already paid for")
    if not session.paid:
        client = _get(db, Client, session.client_id)
        db.add(Payment(
            therapist_id=db.info["therapist_id"], client_id=client.id, amount=client.rate,
            method="Direct", type="session", session_ids=[session.id], auto_recorded=True,
        ))
        session.paid = True
    else:
        db.execute(delete(Payment).where(Payment.auto_recorded, Payment.session_ids.contains([session.id])))
        session.paid = False
    return _state(db)


@router.delete("/sessions/{session_id}", response_model=StateOut)
def delete_session(session_id: int, db: DbSession = Depends(tenant_db)):
    session = _get(db, Session, session_id)
    db.execute(delete(Payment).where(Payment.auto_recorded, Payment.session_ids.contains([session.id])))
    db.delete(session)
    db.flush()
    _remove_recordings(session.therapist_id, [session.id])
    return _state(db)


@router.post("/payments", response_model=StateOut, status_code=201)
def record_payment(body: PaymentIn, db: DbSession = Depends(tenant_db)):
    client = _get(db, Client, body.client_id, lock=True)
    payment = Payment(
        therapist_id=db.info["therapist_id"], client_id=client.id,
        amount=body.amount, method=body.method, type=body.type, date=date.today(),
    )
    if body.type == "prepaid":
        if body.prepaid_sessions < 1:
            raise HTTPException(422, "Choose at least one prepaid session")
        payment.sessions_credit = body.prepaid_sessions
        client.prepaid_credits += body.prepaid_sessions
    else:
        ids = sorted(set(body.session_ids))
        if not ids:
            raise HTTPException(422, "Choose the sessions this payment covers")
        sessions = db.scalars(select(Session).where(Session.id.in_(ids)).with_for_update()).all()
        if len(sessions) != len(ids) or any(s.client_id != client.id for s in sessions):
            raise HTTPException(422, "Some sessions don't belong to this client")
        for s in sessions:
            s.paid = True
        payment.session_ids = ids
    db.add(payment)
    return _state(db)
