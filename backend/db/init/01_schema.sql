CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE therapists (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    client_type     TEXT NOT NULL CHECK (client_type IN ('professional','student','international')),
    rate            NUMERIC(10,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    notes           TEXT NOT NULL DEFAULT '',
    start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    prepaid_credits INTEGER NOT NULL DEFAULT 0 CHECK (prepaid_credits >= 0),
    meet_link       TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clients_therapist_idx ON clients(therapist_id);

CREATE TABLE sessions (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    time            TIME NOT NULL,
    duration        INTEGER NOT NULL CHECK (duration > 0),
    status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
    paid            BOOLEAN NOT NULL DEFAULT false,
    prepaid         BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT NOT NULL DEFAULT '',
    room_name                   TEXT UNIQUE,
    therapist_consented_at      TIMESTAMPTZ,
    client_consented_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_therapist_idx ON sessions(therapist_id);
CREATE INDEX sessions_client_idx ON sessions(client_id);

CREATE TABLE payments (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    amount          NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    date            DATE NOT NULL DEFAULT CURRENT_DATE,
    method          TEXT NOT NULL DEFAULT 'UPI',
    type            TEXT NOT NULL CHECK (type IN ('prepaid','completed','session')),
    session_ids     BIGINT[] NOT NULL DEFAULT '{}',
    sessions_credit INTEGER NOT NULL DEFAULT 0,
    auto_recorded   BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_therapist_idx ON payments(therapist_id);
CREATE INDEX payments_session_ids_idx ON payments USING GIN (session_ids);

CREATE TABLE transcript_segments (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    session_id      BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    speaker         TEXT NOT NULL CHECK (speaker IN ('therapist','client')),
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    text            TEXT NOT NULL,
    embedding       vector(1024),
    text_search     tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX transcript_session_idx ON transcript_segments(session_id, start_ms);
CREATE INDEX transcript_fts_idx ON transcript_segments USING GIN (text_search);

CREATE TABLE session_notes (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    session_id      BIGINT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    format          TEXT NOT NULL DEFAULT 'SOAP' CHECK (format IN ('SOAP','DAP','BIRP')),
    content         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    model           TEXT,
    approved_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TODO: next-session planning (not wired up yet)
CREATE TABLE plan_items (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    source_session_id BIGINT REFERENCES sessions(id) ON DELETE SET NULL,
    source          TEXT NOT NULL CHECK (source IN ('therapist','ai')),
    text            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','done')),
    citations       JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_items_client_idx ON plan_items(client_id, status);
