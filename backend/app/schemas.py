import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer
from pydantic.alias_generators import to_camel

ClientType = Literal["professional", "student", "international"]

# server decides the rate, never trust one from the client
CLIENT_RATES: dict[str, float] = {"professional": 999, "student": 599, "international": 30}


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# --- auth ---
class SignupIn(Camel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=10, max_length=200)


class LoginIn(Camel):
    email: EmailStr
    password: str


class TherapistOut(Camel):
    id: int
    email: str
    full_name: str


class TokenOut(Camel):
    access_token: str
    therapist: TherapistOut


# --- clients ---
class ClientIn(Camel):
    name: str = Field(min_length=1, max_length=200)
    email: str = ""
    phone: str = ""
    client_type: ClientType = "professional"
    notes: str = ""


class ClientPatch(Camel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = None
    phone: str | None = None
    client_type: ClientType | None = None
    notes: str | None = None
    status: Literal["active", "paused"] | None = None


class MeetLinkIn(Camel):
    meet_link: str = Field(default="", max_length=500)


class ClientOut(Camel):
    id: int
    name: str
    email: str
    phone: str
    client_type: str
    rate: float
    status: str
    notes: str
    start_date: dt.date


# --- sessions ---
class SessionIn(Camel):
    client_id: int
    date: dt.date
    time: dt.time
    duration: int = Field(default=50, gt=0, le=480)
    notes: str = ""


class SessionPatch(Camel):
    date: dt.date | None = None
    time: dt.time | None = None
    duration: int | None = Field(default=None, gt=0, le=480)
    notes: str | None = None


NotesStatus = Literal["none", "recorded", "processing", "failed", "draft", "approved"]


class SessionOut(Camel):
    id: int
    client_id: int
    date: dt.date
    time: dt.time
    duration: int
    status: str
    paid: bool
    prepaid: bool
    notes: str
    notes_status: NotesStatus = "none"

    @field_serializer("time")
    def _hhmm(self, t: dt.time) -> str:
        return t.strftime("%H:%M")


# --- payments ---
class PaymentIn(Camel):
    client_id: int
    amount: float = Field(ge=0)
    method: str = "UPI"
    type: Literal["prepaid", "completed"]
    prepaid_sessions: int = Field(default=0, ge=0, le=100)
    session_ids: list[int] = []


class PaymentOut(Camel):
    id: int
    client_id: int
    amount: float
    date: dt.date
    method: str
    type: str
    session_ids: list[int]
    sessions_credit: int
    auto_recorded: bool


class StateOut(Camel):
    clients: list[ClientOut]
    sessions: list[SessionOut]
    payments: list[PaymentOut]
    credits: dict[int, int]
    meet_links: dict[int, str]


# --- video ---
class SpeakerChunks(Camel):
    count: int = 0
    bytes: int = 0


class RecordingStatus(Camel):
    therapist_consented: bool
    client_consented: bool
    recording: bool
    chunks: dict[str, SpeakerChunks]


class RoomOut(Camel):
    server_url: str
    token: str
    status: RecordingStatus


class TherapistRoomOut(RoomOut):
    client_join_url: str


class ClientLinkOut(Camel):
    client_join_url: str


class ConsentIn(Camel):
    consent: bool


class JoinInfoOut(Camel):
    therapist_name: str
    client_first_name: str
    date: dt.date
    time: dt.time
    duration: int
    status: RecordingStatus

    @field_serializer("time")
    def _hhmm(self, t: dt.time) -> str:
        return t.strftime("%H:%M")


class ChunkOut(Camel):
    stored: bool
    status: RecordingStatus


# --- notes ---
class Statement(Camel):
    id: str = Field(max_length=40)
    text: str = Field(min_length=1, max_length=2000)
    segment_ids: list[int] = Field(default_factory=list, max_length=200)
    supported: bool = True


class NoteSections(Camel):
    subjective: list[Statement] = Field(default_factory=list, max_length=100)
    objective: list[Statement] = Field(default_factory=list, max_length=100)
    assessment: list[Statement] = Field(default_factory=list, max_length=100)
    plan: list[Statement] = Field(default_factory=list, max_length=100)


class NoteIn(Camel):
    sections: NoteSections
    risk_flags: list[Statement] = Field(default_factory=list, max_length=50)


class NoteOut(Camel):
    format: str
    status: Literal["draft", "approved"]
    sections: NoteSections
    risk_flags: list[Statement]
    model: str | None
    approved_at: dt.datetime | None
    updated_at: dt.datetime


class TranscriptLineOut(Camel):
    id: int
    speaker: str
    start_ms: int
    end_ms: int
    text: str


class JobOut(Camel):
    status: str
    stage: str
    error: str | None
    created_at: dt.datetime


class NotesOut(Camel):
    status: NotesStatus
    job: JobOut | None
    transcript: list[TranscriptLineOut]
    note: NoteOut | None
    has_audio: bool
