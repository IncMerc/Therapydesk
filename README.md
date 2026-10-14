# TherapyDesk

Practice management for therapists: clients, scheduling, prepaid sessions and payments, plus video
sessions inside the app. Recorded sessions get transcribed and turned into a draft SOAP note that the
therapist reviews and approves.

Stack: React + Vite + Tailwind, FastAPI, Postgres 16 (pgvector), LiveKit, faster-whisper, Ollama.

## Running it

```bash
cp .env.example .env    # fill in the secrets: openssl rand -hex 32
docker compose up -d --build
cd frontend && npm ci && npm run dev
```

App: http://localhost:5173 · API docs: http://localhost:8000/docs · Postgres: localhost:55432

For notes you also need [Ollama](https://ollama.com) running on the host:

```bash
ollama pull llama3.1:8b    # or llama3.2:3b on an 8 GB machine, and set OLLAMA_MODEL in .env
```

The first transcription job downloads the Whisper model (~500 MB for `small`).
`docker compose logs -f worker` shows what the worker is doing.

**Keep a copy of `.env` somewhere.** The database volume is created with those passwords, so if you
lose the file you have to reset with `docker compose down -v`.

## Layout

```
backend/
  app/routers/   auth, practice (clients/sessions/payments), video, notes
  app/ai/        transcription + LLM providers, audio stitching, note drafting
  app/worker.py  background jobs
  db/init/       schema, RLS policies, migrations (run in order on first start)
  tests/
frontend/src/
  App.jsx        main UI
  room/          video call, client join page, recorder
  notes/         transcript + note review
livekit/         local LiveKit config
e2e/             playwright scripts
```

## How some of it works

**Tenant isolation.** Every table has a `therapist_id` and an RLS policy. The API connects as
`app_user`, which doesn't own the tables, and sets `app.therapist_id` per transaction with
`set_config(..., true)` so it can't leak across pooled connections. Two places need to work before a
tenant is known, the client join link and the worker claiming a job, and each is a small
`SECURITY DEFINER` function that returns only ids.

**Video + recording.** Self-hosted LiveKit. Clients join through `/join/<session>.<hmac>` with no
account; rotating the per-session nonce kills old links. Recording needs consent from both sides, and
withdrawing it deletes the session's audio. Each browser records only its own mic with MediaRecorder,
in 5 s chunks, so speaker labels come for free and don't need diarization.

**Notes pipeline.** Marking a recorded session done queues a job (Postgres table +
`FOR UPDATE SKIP LOCKED`). The worker stitches each speaker's chunks, puts both tracks on one timeline
using server receive times, transcribes, deletes the raw audio, then asks the LLM for a SOAP note
where every statement cites transcript line numbers. Citations are checked; anything that doesn't point
at a real line is flagged in the UI rather than dropped. Long transcripts are drafted in chunks and merged.

## AI providers

Defaults are local: faster-whisper in the worker container and Ollama on the host. Nothing leaves the
machine. Groq's free tier also works (`TRANSCRIPTION_PROVIDER=groq`, `LLM_PROVIDER=groq`,
`GROQ_API_KEY=...`). It's much faster but sends audio to a third party, so use it with fake sessions only.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
DATABASE_URL=postgresql+psycopg://app_user:<APP_DB_PASSWORD>@localhost:55432/therapy \
TEST_ADMIN_DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@localhost:55432/therapy \
pytest
```

The tests truncate every table, so don't point them at data you care about.

## Upgrading an existing database

`db/init` only runs on an empty volume. For an existing one, run the newer files by hand:

```bash
docker compose exec -T db psql -U postgres -d therapy -f /docker-entrypoint-initdb.d/03_video_rooms.sql
docker compose exec -T db psql -U postgres -d therapy -f /docker-entrypoint-initdb.d/04_notes_pipeline.sql
```

Both are safe to re-run.
