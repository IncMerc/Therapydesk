# schema + RLS live in db/init/*.sql, these are just the mappings
import datetime as dt
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Therapist(Base):
    __tablename__ = "therapists"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str]
    full_name: Mapped[str]
    password_hash: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(server_default="now()")


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    name: Mapped[str]
    email: Mapped[str] = mapped_column(default="")
    phone: Mapped[str] = mapped_column(default="")
    client_type: Mapped[str]
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    status: Mapped[str] = mapped_column(default="active")
    notes: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[dt.date] = mapped_column(default=dt.date.today)
    prepaid_credits: Mapped[int] = mapped_column(default=0)
    meet_link: Mapped[str] = mapped_column(default="")


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("clients.id"))
    date: Mapped[dt.date]
    time: Mapped[dt.time]
    duration: Mapped[int]
    status: Mapped[str] = mapped_column(default="scheduled")
    paid: Mapped[bool] = mapped_column(default=False)
    prepaid: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    room_name: Mapped[str | None] = mapped_column(default=None)
    client_join_nonce: Mapped[str | None] = mapped_column(default=None)
    therapist_consented_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    client_consented_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("clients.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    date: Mapped[dt.date] = mapped_column(default=dt.date.today)
    method: Mapped[str] = mapped_column(default="UPI")
    type: Mapped[str]
    session_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), default=list)
    sessions_credit: Mapped[int] = mapped_column(default=0)
    auto_recorded: Mapped[bool] = mapped_column(default=False)


class RecordingChunk(Base):
    __tablename__ = "recording_chunks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sessions.id"))
    speaker: Mapped[str]
    segment: Mapped[str]
    seq: Mapped[int]
    bytes: Mapped[int]
    mime_type: Mapped[str]
    received_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default="now()")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sessions.id"))
    status: Mapped[str] = mapped_column(default="queued")
    stage: Mapped[str] = mapped_column(default="waiting")
    error: Mapped[str | None] = mapped_column(Text, default=None)
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default="now()")
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    heartbeat_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sessions.id"))
    speaker: Mapped[str]
    start_ms: Mapped[int]
    end_ms: Mapped[int]
    text: Mapped[str] = mapped_column(Text)


class SessionNote(Base):
    __tablename__ = "session_notes"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    therapist_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("therapists.id"))
    session_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sessions.id"))
    format: Mapped[str] = mapped_column(default="SOAP")
    content: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(default="draft")
    model: Mapped[str | None] = mapped_column(default=None)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default="now()")
