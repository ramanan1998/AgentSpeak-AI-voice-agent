# Agent Speak — AI Voice Agent Platform

An AI calling tool that qualifies leads over real phone calls — with every
conversation, outcome, and cost tracked end to end.

Design an AI voice agent, point it at a contact list, and run outbound campaigns that hold
natural conversations, capture structured data, and route each lead to the right next step
automatically.

---

## What it does

| | |
|---|---|
| **Agent Builder** | Define persona, tone, opening, objection handling, and the exact fields the agent must collect — no code. |
| **Real phone conversations** | Sub-second turn latency over live telephony, with barge-in and interruption handling. |
| **Multi-stage workflows** | Each call outcome (`INTERESTED`, `CALLBACK`, `NO_ANSWER`…) routes to the next stage, a delayed retry, or a human handoff. |
| **Structured data capture** | Email, budget, location, custom fields — extracted post-call and carried across stages so callers are never asked twice. |
| **Silence detection** | Agent checks in on quiet callers, escalates twice, then ends the call gracefully. |
| **Buying intent scoring** | Every completed call scored 0–100 from its transcript. |
| **Campaign engine** | Sequential dialing, per-contact state, retry scheduling, stuck-call watchdog, pause/resume. |
| **Live transcripts & recordings** | Watch conversations stream in real time; replay audio with an AI recap. |
| **Per-call cost metrics** | STT / LLM / TTS spend + avg & peak latency, per call. |

---

## Architecture

```
                    ┌──────────────┐
   Browser ────────►│   React SPA  │  (served by FastAPI from web/dist)
                    └──────┬───────┘
                           │ REST
                    ┌──────▼───────────────────────────┐
                    │  server.py  (FastAPI control plane)│
                    │  • CRUD: agents / contacts /      │
                    │    workflows / campaigns          │
                    │  • CampaignEngine (dial queue)    │
                    │  • /answer /ws /hangup webhooks   │
                    │  • /test/* + /campaign/* reporting│
                    └──────┬────────────────────┬───────┘
                           │                    │
              ┌────────────▼──────┐      ┌──────▼──────┐
              │ services/agent.py │      │  Postgres   │
              │  (Pipecat bot)    │      │  MinIO      │
              │  STT → LLM → TTS  │      └─────────────┘
              └────────┬──────────┘
                       │ media
          ┌────────────┴────────────┐
          │                         │
   ┌──────▼──────┐          ┌───────▼────────┐
   │   Vobiz     │          │  SmallWebRTC   │
   │ (phone, WS) │          │ (browser mic)  │
   └─────────────┘          └────────────────┘
```

**Two call paths, one bot.** `run_bot()` in `services/agent.py` is transport-agnostic:

- **Phone** — Vobiz dials → hits `/answer` (returns XML with `<Stream>` + `<Record>`) →
  opens `/ws?ccid=…` → `FastAPIWebsocketTransport` over µ-law 8k.
- **Browser** — `POST /connect` exchanges SDP → `SmallWebRTCTransport`.

**The bot is DB-decoupled.** It reports back to the control plane over HTTP using the
`campaign` block in its metadata envelope (`{report_url}/status|transcript|report|metrics`).
Test calls point `report_url` at `/test`; campaign calls at `/campaign`.

**Call lifecycle** — the active-call slot is the concurrency guard (one call in flight):

```
_pump          claims slot → dials Vobiz → stashes meta in pending_calls
bot answered   → /campaign/report → _finalize_contact (routes + releases slot)
ring no-answer → Vobiz /hangup → _campaign_hangup → finalize("No Answer")
stuck/no report→ watchdog (MAX_CALL_SECONDS) → finalize("Failed")
dial failed    → mark FAILED + release slot
```

Every path releases the slot, so a campaign can never freeze on one contact

---

## Stack

| Layer | Tech |
|---|---|
| Voice orchestration | Pipecat 1.4.0 |
| STT / LLM / TTS | Deepgram · OpenAI (`gpt-4.1-mini`) · Cartesia |
| VAD / turn-taking | Silero VAD + `SpeechTimeoutUserTurnStopStrategy` |
| Telephony | Vobiz |
| Backend | Python 3.12+, FastAPI, SQLAlchemy (async), asyncpg |
| Frontend | React, TypeScript, Vite, Tailwind, shadcn/ui |
| Data | PostgreSQL, MinIO |
| Infra | Docker Compose, Caddy |

---

## Prerequisites

- Docker + Docker Compose
- A public HTTPS URL Vobiz can reach (`PUBLIC_URL`) — your domain, or a tunnel for local dev
- API keys: OpenAI, Deepgram, Cartesia, Vobiz

---

## Configuration

Create a `.env` in the project root:

```bash
# ===========================
# Cartesia (STT/TTS)
# ===========================
CARTESIA_API_KEY=cartesia_sk_********************
CARTESIA_VOICE_ID=694-****-****-****-3238

# ===========================
# Deepgram (STT/TTS)
# ===========================
DEEPGRAM_API_KEY=deepgram_************************

# ===========================
# OpenAI (STT/LLM/TTS/Realtime)
# ===========================
OPENAI_API_KEY=****************************
OPENAI_MODEL=gpt-4.1-mini

AGENT_NAME=voice-agent
MODE=cascade

# ===========================
# Vobiz SIP
# ===========================
VOBIZ_SIP_DOMAIN=sip.example.com
VOBIZ_USERNAME=voice_agent
VOBIZ_PASSWORD=********
VOBIZ_OUTBOUND_NUMBER=+14155550123
VOBIZ_AUTH_ID=auth_********
VOBIZ_AUTH_TOKEN=token_************************
VOBIZ_FROM=+14155550123
PUBLIC_URL=https://voice.example.com

# ===========================
# PostgreSQL
# ===========================
POSTGRES_USER=postgres
POSTGRES_PASSWORD=********
POSTGRES_DB=voice_agent

DATABASE_URL=postgresql+asyncpg://postgres:********@postgres:5432/voice_agent

# ===========================
# Server
# ===========================
SERVER_PUBLIC_URL=http://server:8000

# ===========================
# MinIO
# ===========================
MINIO_ENDPOINT=minio:9000
MINIO_PUBLIC_URL=http://localhost:9000

MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=********

MINIO_BUCKET=recordings
MINIO_REGION=us-east-1
RECORDINGS_ENABLED=true

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=********

MINIO_INTERNAL_ENDPOINT=minio:9000
MINIO_INTERNAL_SECURE=false

# ===========================
# Groq
# ===========================
GROQ_API_KEY=gsk_****************************
AGENT_AI_MODEL=llama-3.3-70b-versatile
GROQ_BASE_URL=https://api.groq.com/openai/v1

# ===========================
# WebRTC / TURN
# ===========================
SMALLWEBRTC_HOST=webrtc.example.com
TURN_USER=turn_*****
TURN_PASS=********

# ── Tuning (optional — all have sane defaults) ───────────────────
VAD_STOP_SECS=0.4                 # silence before speech-end. Lower = snappier
USER_SPEECH_TIMEOUT=0.6           # pause window before the turn ends
IDLE_TIMEOUT_SECS=10              # silence before the agent checks in (3 strikes → hangup)
MAX_CALL_SECONDS=600              # watchdog: force-finalize a stuck call
RETRY_DAY_SECONDS=10              # accelerated retry clock: 1 "day" = N seconds
VOBIZ_ENCODING=audio/x-mulaw
VOBIZ_SAMPLE_RATE=8000
```

> **`PUBLIC_URL` is the #1 source of "the call never connects."** It must be a *public*
> HTTPS URL. If it's empty, `localhost`, or a rotated tunnel URL, Vobiz rejects the dial with
> `answer_url parameter is not valid`. Verify with:
> `docker compose exec server printenv PUBLIC_URL`

---

## Start

### 1. Build the frontend

The React app is served by FastAPI from `web/dist`, so it must be built before the server
can serve it.

```bash
cd web
npm install
npm run build
cd ..
```

### 2. Bring the stack up

```bash
docker compose up -d --build
```

Then open **http://localhost:8000** (or your `PUBLIC_URL`).

### 3. Verify

```bash
docker compose logs -f server          # watch startup
curl http://localhost:8000/health/db   # → {"status": 1}
```

You should see `Database tables ready` in the logs.

---

## Everyday commands

```bash
# logs
docker compose logs -f server
docker compose logs server | grep -E "OPEN|Vobiz|dial|finalizing"     # a call's lifecycle

# rebuild after code changes  (restart does NOT pick up new code or .env!)
docker compose up -d --build server

# frontend changes → rebuild the bundle, then the image
cd web && npm run build && cd .. && docker compose up -d --build server

# database shell
docker compose exec postgres psql -U postgres -d agentspeak
docker compose exec postgres psql -U postgres -d agentspeak -c "\dt"

# verify env actually landed in the container
docker compose exec server printenv PUBLIC_URL

# stop / reset
docker compose down                    # stop
docker compose down -v                 # stop + WIPE volumes (deletes all data)
```

> **`docker compose restart` does not re-read `.env` or pick up new code.**
> After changing either, use `docker compose up -d --build server`.

---

## Frontend dev mode

Run Vite against the containerized API (CORS is open in dev):

```bash
cd web
npm run dev        # → http://localhost:5173, proxies to http://localhost:8000
```

---

## Using it

1. **Create Agent** — persona, tone, greeting, sign-off, outcomes, and the data fields to collect.
2. **Test your agent** — call your own phone, or talk in the browser. Watch the live transcript.
3. **Contacts** — upload a CSV (`name,phone`) or add manually. Phones must be E.164 (`+91…`).
4. **Workflows** — chain agents into stages and map each outcome to a target
   (next agent / `END` / `HUMAN_TRANSFER`) with optional retry delay.
5. **Campaigns** — pick a workflow + contacts, hit start, watch it dial.
6. **Call History** — transcript, AI recap, collected data, recording, and per-call cost.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/connect` | Browser call — SDP offer → answer (SmallWebRTC) |
| `POST` | `/call` | Phone test call — dials via Vobiz, returns `{ccid, test_session_id}` |
| `POST/GET` | `/answer` | Vobiz webhook → returns `<Stream>` + `<Record>` XML |
| `WS` | `/ws?ccid=` | Vobiz media stream → runs the bot |
| `POST` | `/hangup` | Vobiz hangup webhook |
| `POST` | `/recording-ready` | Vobiz recording callback → auth-download → MinIO |
| `GET` | `/recordings/{ccid}` | Streams a re-hosted recording |
| `POST` | `/test/{status,transcript,report,metrics}` | Bot → test-session reporting |
| `GET` | `/test/sessions`, `/test/session/{id}` | Test history + detail (incl. cost metrics) |
| `POST` | `/campaign/{create,start,pause,resume,stop,reset}` | Campaign control |
| `POST` | `/campaign/{status,transcript,report}` | Bot → campaign reporting |
| `GET` | `/campaign/state`, `/campaign/contact/{id}` | Dashboard polling |
| `GET` | `/agents`, `/contacts`, `/workflows`, `/campaigns` | CRUD |
| `GET` | `/analytics`, `/human-transfers` | Reporting |
| `GET` | `/health/db` | Health check |

---

## Cost metrics

Per-call usage is captured live via a Pipecat `BaseObserver` (LLM tokens, TTS characters,
TTFB samples) and stored as **raw units**. Cost is computed **on read** — so editing a rate
constant instantly re-prices all historical calls, no migration.

Rates live at the top of `server.py`:

```python
STT_USD_PER_MINUTE      = 0.0077   # Deepgram Nova-3 STREAMING (not 0.0043 — that's batch)
LLM_USD_PER_1M_PROMPT   = 0.40     # gpt-4.1-mini input
LLM_USD_PER_1M_COMPLETE = 1.60     # gpt-4.1-mini output
TTS_USD_PER_1M_CHARS    = 25.0     # ← set from your Cartesia plan's $/credit
```

Notes:
- **STT seconds is an estimate** (derived from call duration — Pipecat 1.4.0 emits no STT
  usage metric). Flagged `estimated: true` in the API response.
- **LLM dominates** cost and grows superlinearly with call length: the full context is
  re-sent every turn.

---

## Latency tuning

Typical: **~0.7s per turn**, ~2–3s to first greeting.

| Knob | Default | Effect |
|---|---|---|
| `VAD_STOP_SECS` | `0.4` | Silence before speech-end. Lower = snappier, more interruption-prone. |
| `USER_SPEECH_TIMEOUT` | `0.6` | Pause window before the turn ends. Raise if slow talkers get cut off. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Biggest single lever — LLM TTFB is the largest slice. |

Design choices that matter: Silero VAD is loaded **once at import** (not per call), and turn
detection is **VAD-only** (`SpeechTimeoutUserTurnStopStrategy`) — no Smart Turn model, so no
per-turn ONNX inference and no per-call model load.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Vobiz dial failed: answer_url parameter is not valid` | `PUBLIC_URL` is empty, `localhost`, or stale. Must be public HTTPS. Recreate the container after editing `.env`. |
| Call rings, agent never speaks | `/ws` not reachable, or a service key missing in the container. Check `docker compose logs server`. |
| Browser call: `/connect` 200 but no audio | WebRTC ICE can't connect — the server advertises private Docker IPs. Works on localhost; deployed needs public-IP/STUN + open UDP, or TURN. **Phone calls are unaffected** (WebSocket, no ICE). |
| `column ... does not exist` | Model changed but the table didn't. `create_all` never ALTERs. Add columns via `ALTER TABLE`, or drop the table and restart. |
| `POST /recording-ready 405` | Route not defined as `@app.post`, so it hits the GET-only SPA catch-all. |
| Recording URL 401s | Vobiz recordings need `X-Auth-ID`/`X-Auth-Token`. They're auth-downloaded server-side and re-hosted in MinIO — a raw Vobiz URL will never play in `<audio>`. |
| Frontend changes not showing | The SPA is served from `web/dist`. Run `npm run build`, then rebuild the image. |

---

## Known limitations

- **One campaign, one call at a time.** The engine is an in-process singleton with a single
  active-call slot. Concurrency requires a distributed queue + splitting media workers from
  the API.
- **Single instance only.** `pending_calls` is an in-memory dict — a second replica breaks
  the phone path (the `/ws` may land on the instance that didn't stash the meta).
- **No migrations.** Schema is provisioned by `create_all`; column changes need manual
  `ALTER TABLE`. Adopt Alembic before there's data you can't lose.
- **No multi-tenancy.** `workflow_name` and `contact.phone` are globally unique.
- **Engine state is in memory by design** — a restart reconciles `RUNNING` campaigns to
  `PAUSED`, resumable from the DB.
- **Browser calls don't work behind NAT** without public-IP/UDP config or a TURN server.