-- idempotent, can be re-run on an existing db

-- join link = hmac(nonce). rotate the nonce to kill old links
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_join_nonce TEXT;

-- segment = one continuous MediaRecorder run (a reload starts a new one)
CREATE TABLE IF NOT EXISTS recording_chunks (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    session_id      BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    speaker         TEXT NOT NULL CHECK (speaker IN ('therapist','client')),
    segment         TEXT NOT NULL CHECK (segment ~ '^[A-Za-z0-9-]{8,64}$'),
    seq             INTEGER NOT NULL CHECK (seq >= 0),
    bytes           INTEGER NOT NULL,
    mime_type       TEXT NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, speaker, segment, seq)
);
CREATE INDEX IF NOT EXISTS recording_chunks_session_idx ON recording_chunks(session_id, speaker, segment, seq);

GRANT SELECT, INSERT, UPDATE, DELETE ON recording_chunks TO app_user;
GRANT USAGE, SELECT ON SEQUENCE recording_chunks_id_seq TO app_user;
ALTER TABLE recording_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recording_chunks;
CREATE POLICY tenant_isolation ON recording_chunks
  USING (therapist_id = current_setting('app.therapist_id', true)::bigint)
  WITH CHECK (therapist_id = current_setting('app.therapist_id', true)::bigint);

-- clients have no account, so we need the tenant before we can set it. security definer, returns the bare minimum
CREATE OR REPLACE FUNCTION join_link_lookup(p_session_id BIGINT)
RETURNS TABLE (therapist_id BIGINT, client_join_nonce TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.therapist_id, s.client_join_nonce FROM sessions s
  WHERE s.id = p_session_id AND s.client_join_nonce IS NOT NULL
$$;
REVOKE ALL ON FUNCTION join_link_lookup(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_link_lookup(BIGINT) TO app_user;
