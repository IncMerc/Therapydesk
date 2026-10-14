-- idempotent, can be re-run on an existing db

CREATE TABLE IF NOT EXISTS processing_jobs (
    id              BIGSERIAL PRIMARY KEY,
    therapist_id    BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    session_id      BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    stage           TEXT NOT NULL DEFAULT 'waiting' CHECK (stage IN ('waiting','transcribing','drafting','finished')),
    error           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    heartbeat_at    TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS processing_jobs_session_idx ON processing_jobs(session_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_one_active
    ON processing_jobs(session_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS processing_jobs_queue_idx ON processing_jobs(created_at) WHERE status IN ('queued','running');

GRANT SELECT, INSERT, UPDATE, DELETE ON processing_jobs TO app_user;
GRANT USAGE, SELECT ON SEQUENCE processing_jobs_id_seq TO app_user;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON processing_jobs;
CREATE POLICY tenant_isolation ON processing_jobs
  USING (therapist_id = current_setting('app.therapist_id', true)::bigint)
  WITH CHECK (therapist_id = current_setting('app.therapist_id', true)::bigint);

-- worker is cross-tenant, so claiming bypasses RLS here; the job itself runs as its tenant.
-- also picks up jobs whose worker stopped heartbeating
CREATE OR REPLACE FUNCTION claim_next_job(p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes')
RETURNS TABLE (job_id BIGINT, therapist_id BIGINT, session_id BIGINT, attempts INTEGER)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE processing_jobs j
     SET status = 'running', attempts = j.attempts + 1, started_at = now(), heartbeat_at = now(), error = NULL
   WHERE j.id = (
         SELECT q.id FROM processing_jobs q
          WHERE q.status = 'queued' OR (q.status = 'running' AND q.heartbeat_at < now() - p_stale_after)
          ORDER BY q.created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1)
  RETURNING j.id, j.therapist_id, j.session_id, j.attempts
$$;
REVOKE ALL ON FUNCTION claim_next_job(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_job(INTERVAL) TO app_user;
