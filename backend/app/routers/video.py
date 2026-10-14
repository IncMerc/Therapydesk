# therapist routes use the normal JWT; client routes are authed by the signed key in the join link.
# speaker on a chunk comes from which route it was uploaded through, not from the request body.
import datetime as dt
import os
import re
import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import SessionLocal
from ..deps import tenant_db
from ..models import Client, RecordingChunk, Session, Therapist
from ..schemas import (
    ChunkOut, ClientLinkOut, ConsentIn, JoinInfoOut, RecordingStatus, RoomOut, SpeakerChunks, TherapistRoomOut,
)
from .. import video

router = APIRouter(prefix="/api", tags=["video"])

SEGMENT_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
ALLOWED_AUDIO = ("audio/webm", "audio/ogg", "audio/mp4")


def _session(db: DbSession, session_id: int, *, lock: bool = False) -> Session:
    stmt = select(Session).where(Session.id == session_id)
    s = db.scalar(stmt.with_for_update() if lock else stmt)
    if s is None:
        raise HTTPException(404, "Session not found")
    return s


def _status(db: DbSession, s: Session) -> RecordingStatus:
    rows = db.execute(
        select(RecordingChunk.speaker, func.count(), func.coalesce(func.sum(RecordingChunk.bytes), 0))
        .where(RecordingChunk.session_id == s.id)
        .group_by(RecordingChunk.speaker)
    ).all()
    chunks = {"therapist": SpeakerChunks(), "client": SpeakerChunks()}
    for speaker, count, total in rows:
        chunks[speaker] = SpeakerChunks(count=count, bytes=total)
    both = s.therapist_consented_at is not None and s.client_consented_at is not None
    return RecordingStatus(
        therapist_consented=s.therapist_consented_at is not None,
        client_consented=s.client_consented_at is not None,
        recording=both and s.status == "scheduled",
        chunks=chunks,
    )


def _session_dir(s: Session) -> Path:
    return Path(get_settings().recordings_dir) / str(s.therapist_id) / str(s.id)


def _ensure_room(s: Session) -> None:
    if s.room_name is None:
        s.room_name = video.new_room_name(s.id)
    if s.client_join_nonce is None:
        s.client_join_nonce = video.new_join_nonce()


def _set_consent(db: DbSession, s: Session, speaker: str, consent: bool) -> None:
    if consent and s.status != "scheduled":
        raise HTTPException(409, "This session has ended")
    value = dt.datetime.now(dt.timezone.utc) if consent else None
    if speaker == "therapist":
        s.therapist_consented_at = value
    else:
        s.client_consented_at = value
    if not consent:
        # withdrawing consent wipes the whole session's audio, both speakers
        db.execute(delete(RecordingChunk).where(RecordingChunk.session_id == s.id))
        shutil.rmtree(_session_dir(s), ignore_errors=True)


async def _store_chunk(request: Request, db: DbSession, s: Session, speaker: str, segment: str, seq: int) -> ChunkOut:
    settings = get_settings()
    if not SEGMENT_RE.match(segment) or not 0 <= seq <= 100_000:
        raise HTTPException(422, "Invalid segment or sequence number")
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime not in ALLOWED_AUDIO:
        raise HTTPException(415, "Upload audio/webm, audio/ogg or audio/mp4")
    declared = request.headers.get("content-length")
    if declared and int(declared) > settings.max_chunk_bytes:
        raise HTTPException(413, "Audio chunk too large")

    status = _status(db, s)
    if not status.recording:
        raise HTTPException(409, "Recording is off for this session")

    body = await request.body()
    if not body or len(body) > settings.max_chunk_bytes:
        raise HTTPException(413 if body else 422, "Audio chunk is empty or too large")

    # retries of the same chunk are a no-op
    inserted = db.execute(
        insert(RecordingChunk)
        .values(therapist_id=s.therapist_id, session_id=s.id, speaker=speaker, segment=segment,
                seq=seq, bytes=len(body), mime_type=mime)
        .on_conflict_do_nothing(index_elements=["session_id", "speaker", "segment", "seq"])
        .returning(RecordingChunk.id)
    ).scalar()
    if inserted is not None:
        folder = _session_dir(s) / speaker / segment
        folder.mkdir(parents=True, exist_ok=True)
        final = folder / f"{seq:06d}.chunk"
        tmp = final.with_suffix(".tmp")
        tmp.write_bytes(body)
        os.replace(tmp, final)
    return ChunkOut(stored=inserted is not None, status=_status(db, s))


@router.post("/sessions/{session_id}/room", response_model=TherapistRoomOut)
def therapist_join_room(session_id: int, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id, lock=True)
    if s.status != "scheduled":
        raise HTTPException(409, "This session has ended")
    _ensure_room(s)
    therapist = db.get(Therapist, s.therapist_id)
    db.flush()
    return TherapistRoomOut(
        server_url=get_settings().livekit_url,
        token=video.livekit_token(room=s.room_name, identity="therapist", name=therapist.full_name),
        client_join_url=video.join_url(s.id, s.client_join_nonce),
        status=_status(db, s),
    )


@router.post("/sessions/{session_id}/client-link", response_model=ClientLinkOut)
def client_link(session_id: int, rotate: bool = False, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id, lock=True)
    _ensure_room(s)
    if rotate:
        s.client_join_nonce = video.new_join_nonce()
    return ClientLinkOut(client_join_url=video.join_url(s.id, s.client_join_nonce))


@router.get("/sessions/{session_id}/recording", response_model=RecordingStatus)
def therapist_recording_status(session_id: int, db: DbSession = Depends(tenant_db)):
    return _status(db, _session(db, session_id))


@router.post("/sessions/{session_id}/consent", response_model=RecordingStatus)
def therapist_consent(session_id: int, body: ConsentIn, db: DbSession = Depends(tenant_db)):
    s = _session(db, session_id, lock=True)
    _set_consent(db, s, "therapist", body.consent)
    return _status(db, s)


@router.put("/sessions/{session_id}/recording/{segment}/{seq}", response_model=ChunkOut)
async def therapist_chunk(session_id: int, segment: str, seq: int, request: Request, db: DbSession = Depends(tenant_db)):
    return await _store_chunk(request, db, _session(db, session_id), "therapist", segment, seq)


@dataclass
class JoinContext:
    db: DbSession
    session: Session


def join_context(key: str) -> Iterator[JoinContext]:
    invalid = HTTPException(404, "This link isn't valid. Ask your therapist for a new one.")
    parsed = video.parse_join_key(key)
    if parsed is None:
        raise invalid
    session_id, mac = parsed
    with SessionLocal() as db, db.begin():
        row = db.execute(text("SELECT therapist_id, client_join_nonce FROM join_link_lookup(:sid)"), {"sid": session_id}).first()
        if row is None or not video.mac_matches(session_id, row.client_join_nonce, mac):
            raise invalid
        db.execute(text("SELECT set_config('app.therapist_id', :tid, true)"), {"tid": str(row.therapist_id)})
        s = _session(db, session_id, lock=True)
        yield JoinContext(db=db, session=s)


def _open(ctx: JoinContext) -> Session:
    if ctx.session.status != "scheduled":
        raise HTTPException(410, "This session has ended")
    return ctx.session


@router.get("/join/{key}", response_model=JoinInfoOut)
def join_info(ctx: JoinContext = Depends(join_context)):
    s = ctx.session
    client = ctx.db.get(Client, s.client_id)
    therapist = ctx.db.get(Therapist, s.therapist_id)
    return JoinInfoOut(
        therapist_name=therapist.full_name, client_first_name=client.name.split(" ")[0],
        date=s.date, time=s.time, duration=s.duration, status=_status(ctx.db, s),
    )


@router.post("/join/{key}/room", response_model=RoomOut)
def client_join_room(ctx: JoinContext = Depends(join_context)):
    s = _open(ctx)
    client = ctx.db.get(Client, s.client_id)
    return RoomOut(
        server_url=get_settings().livekit_url,
        token=video.livekit_token(room=s.room_name, identity="client", name=client.name.split(" ")[0]),
        status=_status(ctx.db, s),
    )


@router.get("/join/{key}/recording", response_model=RecordingStatus)
def client_recording_status(ctx: JoinContext = Depends(join_context)):
    return _status(ctx.db, ctx.session)


@router.post("/join/{key}/consent", response_model=RecordingStatus)
def client_consent(body: ConsentIn, ctx: JoinContext = Depends(join_context)):
    _set_consent(ctx.db, ctx.session, "client", body.consent)
    return _status(ctx.db, ctx.session)


@router.put("/join/{key}/recording/{segment}/{seq}", response_model=ChunkOut)
async def client_chunk(segment: str, seq: int, request: Request, ctx: JoinContext = Depends(join_context)):
    return await _store_chunk(request, ctx.db, _open(ctx), "client", segment, seq)
