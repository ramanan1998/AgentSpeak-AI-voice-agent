# LiveKit Voice Agent + Live Metrics Dashboard

A LiveKit voice assistant with a single-page dashboard. It works in **two modes**:

- **📞 Call my phone** — enter a phone number; the AI agent dials it over a **Vobiz SIP trunk**.
  You talk on your phone while the web page shows the live transcript and metrics.
- **🎙️ Talk in the browser** — talk to the agent directly over WebRTC using your microphone.

Either way you get a **live transcript**, a **token/latency metrics dashboard**, and an
**end-of-call summary** (stats + AI recap) when you hang up.

It also has a **Campaigns** page for **bulk outbound calling** from a CSV (sequential calls,
live status + transcript monitoring, per-contact summary/transcript), and the agent exposes an
**`end_call`** tool so the LLM can hang up gracefully when the caller says goodbye.

---

## Campaigns (bulk calling)

Open the **Campaigns** item in the sidebar.

1. **Upload a CSV** of `Name, Mobile Number` (one per line, numbers in E.164 like `+9198...`).
   Invalid numbers are skipped and reported; valid contacts appear in a table.
2. **Start campaign** — contacts are called **one at a time, sequentially**. When a call ends
   (finished/failed/disconnected) the next one starts automatically.
3. While a call is active you see **live transcription only** (no audio playback in the browser),
   plus real-time **status** per contact and **progress** counts (Total / Completed / Failed /
   Remaining / Currently calling).
4. After each call, the **summary** and full **transcript** are stored against the contact —
   open them from the row's **⋮** menu (View Summary / View Transcript).

> **In-memory only.** All campaign data (contacts, statuses, transcripts, summaries) lives in
> the server process and is **lost on restart** — there is no database. The campaign code in
> `server.py` is isolated so it can be swapped for a DB later.

How it works: the server dispatches the agent per contact with campaign metadata; the agent
calls back to the server (`/campaign/transcript` live, `/campaign/report` at the end), which
advances the queue. The browser polls `/campaign/state`. Set `SERVER_PUBLIC_URL` in `.env` if the
agent can't reach the server at `http://127.0.0.1:8000`.

The **`end_call`** tool: during any call, if the caller says they're done ("bye", "that's all"),
the LLM calls `end_call`, the agent speaks a short closing line, and the call ends gracefully.

---

## Features

- **Two call modes** from one page — outbound phone (SIP) or browser microphone (WebRTC).
- **Live transcript** — user and agent turns stream in via LiveKit transcriptions.
- **Live metrics dashboard** (updates per turn):
  - **Tokens** — cumulative input / output / total, last-turn tokens-per-second.
  - **Latency** — TTFT, TTFA (time to first audio), TTS TTFB, end-of-utterance delay.
  - **Activity** — LLM calls, STT audio seconds, TTS characters, TTS audio seconds.
  - **Session** — status, live duration, agent state, room name.
- **End-of-call summary** — duration, turns, total tokens, avg + peak latency, and a short
  **AI recap** of the conversation, with the transcript + metrics frozen on screen.
- **LiveKit Inference pipeline** with primary/backup providers for LLM, STT, and TTS — no
  separate OpenAI/Deepgram keys required.

---

## Architecture

```
┌──────────────┐   POST /connect or /call    ┌──────────────┐
│   Browser    │ ─────────────────────────►  │  server.py   │
│ (index.html) │                             │  (FastAPI)   │
└──────┬───────┘                             └──────┬───────┘
       │ joins room (WebRTC)                        │ dispatches agent
       │ + data channel                             ▼
       │                                     ┌──────────────────┐
       └──────── observes / talks ────────►  │  LiveKit Cloud   │
                                             │     (room)       │
                          phone leg (SIP) ◄──┤  + agent.py      │
                          via Vobiz trunk    │  STT→LLM→TTS     │
                                             └──────────────────┘
```

Two processes run side by side:

1. **`server.py`** — FastAPI app. Serves `index.html` and exposes two endpoints that both
   **explicitly dispatch** the agent and return a room token:
   - `POST /connect` → browser-mic mode (publish-capable token).
   - `POST /call {phone}` → outbound mode (observer token; agent dials the phone).
2. **`agent.py`** — a LiveKit Agent worker (`agent_name="voice-agent"`). On dispatch it reads
   the job metadata: if a `phone_number` is present it **dials out over the Vobiz SIP trunk**
   (`create_sip_participant`), otherwise it runs in browser-mic mode. In both modes it
   publishes metrics, call status, transcript, and the end-of-call summary back to the page
   over the LiveKit **data channel**.

### Data-channel messages (agent → browser)

| Topic      | Message                                                            |
|------------|--------------------------------------------------------------------|
| `metrics`  | `{type:"metric", metric_type:"llm\|stt\|tts\|eou\|ttfa\|state", data}` |
| `status`   | `{type:"call_status", status:"dialing\|active\|failed", detail}`   |
| `summary`  | `{type:"summary", text}`                                           |

Browser → agent: `{type:"end_call"}` (sent on hang up to request the recap / end the call).

---

## Files

| File             | Purpose                                                                       |
|------------------|-------------------------------------------------------------------------------|
| `agent.py`       | Agent worker — voice pipeline, SIP dial-out, metrics, call status, AI recap.  |
| `server.py`      | FastAPI — serves the page, dispatches the agent, vends tokens.                |
| `index.html`     | Single-page UI — mode toggle, transcript, metrics dashboard, summary.         |
| `setup_trunk.py` | Create/update the LiveKit outbound SIP trunk from your Vobiz credentials.     |
| `.env`           | Credentials and config (not committed).                                       |
| `.env.example`   | Template for `.env` (no secrets).                                             |
| `pyproject.toml` | Dependencies.                                                                 |

---

## Prerequisites

- **Python 3.11+** and [**uv**](https://docs.astral.sh/uv/).
- A **LiveKit Cloud** project (WebRTC + Inference gateway).
- For phone calls: a **Vobiz SIP trunk** (SIP domain, auth username/password, a DID number).

---

## Setup

### 1. Configure `.env`

Copy the template and fill it in (see `.env.example`):

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

AGENT_NAME=voice-agent

# Vobiz SIP trunk (only needed for outbound phone calls)
VOBIZ_SIP_DOMAIN=xxxx.sip.vobiz.ai
VOBIZ_USERNAME=...            # Vobiz Auth ID
VOBIZ_PASSWORD=...            # Vobiz Auth Token
VOBIZ_OUTBOUND_NUMBER=+91XXXXXXXXXX   # your DID / caller-ID
OUTBOUND_TRUNK_ID=           # filled in by setup_trunk.py
```

### 2. Install dependencies

```powershell
uv sync
```

### 3. (Phone mode only) Create the SIP trunk

Once the `VOBIZ_*` values are set, register the trunk with LiveKit:

```powershell
uv run python setup_trunk.py
```

- If `OUTBOUND_TRUNK_ID` is empty, it **creates** a trunk and prints an `ST_...` id —
  paste that into `.env` as `OUTBOUND_TRUNK_ID`.
- If it's already set, it **updates** that trunk's credentials.

> Browser-mic mode needs none of the Vobiz config — you can skip steps 3 entirely if you
> only want in-browser calls.

---

## Running

Two terminals:

**Terminal 1 — the agent worker:**

```powershell
uv run python agent.py start
```

Wait for `registered worker`. (Use `agent.py dev` during development for auto-reload.)

**Terminal 2 — the web server:**

```powershell
uv run python server.py
```

Open **http://localhost:8000**.

### Using it

- **Call my phone:** type your number in international format (e.g. `+917708139259`) and
  click **Call my phone**. Your phone rings; answer it and talk. The page shows the live
  transcript + metrics.
- **Talk in the browser:** click **Talk in the browser** and allow the microphone.
- Click **Hang up** to end — the summary panel shows stats + an AI recap, with the
  transcript and metrics frozen. **Start new call** resets.

---

## Configuration

- **Agent personality** — `instructions` in the `Assistant` class (`agent.py`).
- **Providers** — the LLM/STT/TTS models + fallbacks in the `AgentSession(...)` block (`agent.py`).
- **Agent name** — `AGENT_NAME` (must match in `agent.py` and `server.py`).
- **Web server port** — defaults to `8000`; change `uvicorn.run(...)` in `server.py`.
- **Recap timeout** — the browser waits up to 12 s for the AI recap; see `endCall()` in `index.html`.

---

## Troubleshooting (phone mode)

| Symptom                          | Likely cause / fix                                                  |
|----------------------------------|---------------------------------------------------------------------|
| `OUTBOUND_TRUNK_ID not configured`| Run `setup_trunk.py` and set `OUTBOUND_TRUNK_ID` in `.env`.        |
| Call status → **Failed**, 401/500 (auth)| Wrong `VOBIZ_USERNAME`/`VOBIZ_PASSWORD`; re-run `setup_trunk.py`. |
| No ring / 408 timeout            | Check `VOBIZ_SIP_DOMAIN`, the dialed number's country code, and Vobiz balance. |
| Page can't reach server          | Make sure `server.py` is running on port 8000.                      |

---

## Notes & limitations

- Each call uses a unique room; tokens are dev-grade — tighten grants and add auth before
  exposing publicly.
- The AI recap costs a few extra tokens per call (one short LLM request on hang up).
- Real-time voice behavior (audio, transcript, metrics, recap) can only be verified by
  placing an actual call.
