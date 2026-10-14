-- api sets app.therapist_id per transaction. unset -> NULL -> no rows match

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','sessions','payments','transcript_segments','session_notes','plan_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (therapist_id = current_setting('app.therapist_id', true)::bigint)
        WITH CHECK (therapist_id = current_setting('app.therapist_id', true)::bigint)
    $p$, t);
  END LOOP;
END $$;

-- no RLS on therapists (login looks up by email before we know who you are)
REVOKE UPDATE, DELETE ON therapists FROM app_user;

CREATE FUNCTION assert_same_therapist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.therapist_id = NEW.therapist_id) THEN
    RAISE EXCEPTION 'client % does not belong to therapist %', NEW.client_id, NEW.therapist_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_same_therapist BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION assert_same_therapist();
CREATE TRIGGER payments_same_therapist BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION assert_same_therapist();
