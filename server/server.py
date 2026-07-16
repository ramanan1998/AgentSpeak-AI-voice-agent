"""
server.py — the FastAPI control plane. Drives the Pipecat voice bot (agent.py):
  * POST /connect       → browser-microphone mode (SmallWebRTC; returns an SDP answer)
  * POST /call {phone}  → outbound phone mode (Vobiz dials; the bot answers over a WS stream)

Run with:  python server.py
Then open:  http://localhost:8000
"""

import asyncio
import csv
import io
import json
import os
import random
import time
import uuid
from pathlib import Path

import httpx
from services import agent as voice_bot
from dotenv import load_dotenv
from loguru import logger
from fastapi import FastAPI, HTTPException, Depends, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from database import engine, Base, AsyncSessionLocal, get_db
from storage import ensure_recordings_bucket, ingest_vobiz_recording, get_recording_bytes
from models import *
from fastapi import BackgroundTasks
from aiortc import RTCIceServer
from pipecat.transports.smallwebrtc.request_handler import (   # [V] confirm names on 1.4
    SmallWebRTCRequestHandler,
    SmallWebRTCRequest,
    SmallWebRTCPatchRequest,
)
# from services.agent_ai import router as agent_ai_router
import uvicorn

load_dotenv()

# $ per unit — cost is computed on read, so editing these re-prices all history.
STT_USD_PER_MINUTE      = 0.0077   # Deepgram Nova-3 STREAMING (official: deepgram.com — NOT 0.0043, that's batch)
LLM_USD_PER_1M_PROMPT   = 0.40     # gpt-4.1-mini input  — confirmed openai.com/api/pricing
LLM_USD_PER_1M_COMPLETE = 1.60     # gpt-4.1-mini output — confirmed openai.com/api/pricing
TTS_USD_PER_1M_CHARS    = 25.0     # ← Cartesia: ~1 credit/char; SET from your plan's $/credit

# Vobiz telephony
VOBIZ_AUTH_ID = os.environ["VOBIZ_AUTH_ID"]
VOBIZ_AUTH_TOKEN = os.environ["VOBIZ_AUTH_TOKEN"]
VOBIZ_FROM = os.environ["VOBIZ_FROM"]            # your Vobiz caller-ID / DID, E.164
VOBIZ_CALL_URL = f"https://api.vobiz.ai/api/v1/Account/{VOBIZ_AUTH_ID}/Call/"

# PUBLIC https URL Vobiz can reach (ngrok / domain) — used for answer_url and the wss stream.
PUBLIC_URL = os.environ["PUBLIC_URL"]
# Internal base the bot uses to report back into this server (loopback is fine; same machine).
SERVER_BASE = os.getenv("SERVER_PUBLIC_URL", "http://127.0.0.1:8000")

# ccid -> metadata envelope, stashed at dial time and consumed by the /ws handler (added later).
pending_calls: dict[str, dict] = {}

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# "Create Agent with AI" — generation endpoint lives in services/agent_ai.py.
# Returns a draft only; saving still goes through POST /agents.
# app.include_router(agent_ai_router)

async def _ensure_campaign_status_values():
    """Phase 2: make sure newer campaign_status enum values exist on pre-existing databases.
    Schema is provisioned via create_all, which won't ALTER an existing enum type, so we add
    the values idempotently. ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction AND via
    asyncpg's simple query protocol — SQLAlchemy's normal execute uses the prepared/extended
    protocol which trips this DDL. So reach the raw asyncpg connection under AUTOCOMMIT."""
    try:
        ac_engine = engine.execution_options(isolation_level="AUTOCOMMIT")
        async with ac_engine.connect() as conn:
            raw = await conn.get_raw_connection()
            driver = raw.driver_connection  # the underlying asyncpg.Connection
            for member in CampaignStatus:
                await driver.execute(f"ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS '{member.name}'")
        print("[startup] campaign_status enum values ensured")
    except Exception as e:
        print(f"[startup] campaign_status enum ensure FAILED: {e!r}")


async def _reconcile_running_campaigns():
    """Phase 2: any campaign left RUNNING by a previous process is stale — the in-memory
    queue didn't survive the restart. If all its contacts are done, mark it DONE; otherwise
    mark it PAUSED so it can be resumed."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Campaign).where(Campaign.status == CampaignStatus.RUNNING))
            stale = result.scalars().all()
            for camp in stale:
                contacts = await _load_contacts(db, camp.id)
                all_done = bool(contacts) and all(c.done for c in contacts)
                camp.status = CampaignStatus.DONE if all_done else CampaignStatus.PAUSED
            if stale:
                await db.commit()
    except Exception as e:
        print(f"[startup] running-campaign reconcile skipped: {e}")


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await _ensure_campaign_status_values()
    await _reconcile_running_campaigns()

    print("Database tables ready")
    ensure_recordings_bucket()

@app.get("/health/db")
async def health_db():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT 1"))
        return {"status": result.scalar()}


def _ws_url(ccid: str) -> str:
    base = PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://")
    return f"{base}/ws?ccid={ccid}"

async def _dial_vobiz(to_phone: str, ccid: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            VOBIZ_CALL_URL,
            headers={"X-Auth-ID": VOBIZ_AUTH_ID, "X-Auth-Token": VOBIZ_AUTH_TOKEN},
            json={
                "from": VOBIZ_FROM,
                "to": to_phone,
                "answer_url": f"{PUBLIC_URL}/answer?ccid={ccid}",
                "answer_method": "POST",
                "hangup_url": f"{PUBLIC_URL}/hangup?ccid={ccid}",
                "hangup_method": "POST",
            },
        )
        if r.status_code >= 400:
            print(f"[vobiz] {r.status_code} body={r.text}")   # <-- the actual reason
        r.raise_for_status()


class ConnectRequest(BaseModel):
    agent: str = ""          # agent workflow_name (required)
    sdp: str = ""            # browser WebRTC SDP offer
    type: str = "offer"


class CallRequest(BaseModel):
    phone: str
    agent: str = ""          # agent workflow_name (required)

class TestStatusRequest(BaseModel):
    campaign_contact_id: str
    status: str

class TestTranscriptRequest(BaseModel):
    campaign_contact_id: str
    role: str
    text: str

class TestReportRequest(BaseModel):
    campaign_contact_id: str
    status: str = ""
    summary: str = ""
    outcome: str = ""
    collected: dict = {}
    callback_in_days: float | None = None
    callback_note: str = ""

class TestRecordingRequest(BaseModel):
    campaign_contact_id: str
    recording_url: str
    egress_id: str = ""

class TestMetricsRequest(BaseModel):
    campaign_contact_id: str
    stt_audio_seconds: float = 0
    llm_prompt_tokens: int = 0
    llm_completion_tokens: int = 0
    tts_characters: int = 0
    turns: int = 0
    ttft_samples: list[float] = []
    duration_seconds: float = 0


def _agent_to_cfg(a: Agent) -> dict:
    """Serialize an Agent row into the dict shape agent.build_instructions expects."""
    return {
        "workflow_name": a.workflow_name,
        "agent_name": a.agent_name,
        "instruction_prompt": a.instruction_prompt,
        "tone": a.tone,
        "negative_instructions": a.negative_instructions,
        "data_fields": a.data_fields,
        "greeting": a.greeting,
        "sign_off": a.sign_off,
        "outcomes": a.outcomes,
    }


async def _require_agent(agent: str, db: AsyncSession) -> dict:
    wf = (agent or "").strip()
    if not wf:
        raise HTTPException(status_code=400, detail="Select an agent first.")
    row = await db.get(Agent, wf)
    if not row:
        raise HTTPException(status_code=400, detail="Select an agent first.")
    return _agent_to_cfg(row)


# One handler for the whole app; manages POST offers + PATCH ICE candidates + pc_id reuse.
_smallwebrtc = SmallWebRTCRequestHandler(
    ice_servers=[
        RTCIceServer(
            urls="turn:45.195.159.250:3478?transport=udp",
            username=os.environ["TURN_USER"],
            credential=os.environ["TURN_PASS"],
        ),
    ],
    host=os.getenv("SMALLWEBRTC_HOST") or None,
)

@app.post("/connect")
async def connect_browser(request: SmallWebRTCRequest, background_tasks: BackgroundTasks,
                          agent: str = "", db: AsyncSession = Depends(get_db)):
    agent_cfg = await _require_agent(agent, db)

    ts = TestSession(mode="browser", agent_workflow=agent,
                     agent_name=agent_cfg.get("agent_name", ""))
    db.add(ts)
    await db.commit()
    tsid = str(ts.id)

    meta = {
        "agent": agent_cfg, "context": {}, "master_fields": [], "focus": [],
        "contact_name": "",
        "campaign": {"campaign_contact_id": tsid, "report_url": f"{SERVER_BASE}/test"},
    }

    async def _on_connection(connection):
        background_tasks.add_task(voice_bot.run_browser_bot, connection, meta)

    return await _smallwebrtc.handle_web_request(request, _on_connection)

@app.patch("/connect")
async def connect_browser_patch(request: SmallWebRTCPatchRequest):
    return await _smallwebrtc.handle_patch_request(request)  

@app.api_route("/answer", methods=["POST", "GET"])
async def answer(ccid: str = ""):
    ws = _ws_url(ccid)
    enc = os.getenv("VOBIZ_ENCODING", "audio/x-mulaw")
    rate = int(os.getenv("VOBIZ_SAMPLE_RATE", "8000"))
    content_type = f"{enc};rate={rate}"
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Record fileFormat="wav" maxLength="3600" recordSession="true" '
        f'callbackUrl="{PUBLIC_URL}/recording-ready?ccid={ccid}" callbackMethod="POST"></Record>'
        f'<Stream bidirectional="true" audioTrack="inbound" '
        f'contentType="{content_type}" keepCallAlive="true">{ws}</Stream>'
        "</Response>"
    )
    return Response(content=xml, media_type="application/xml")

@app.post("/recording-finished")
async def recording_finished(ccid: str = ""):
    return Response(status_code=204)   # Vobiz just wants a 2xx ack

@app.post("/recording-ready")
async def recording_ready(request: Request, background_tasks: BackgroundTasks, ccid: str = ""):
    form = await request.form()
    url = form.get("RecordUrl", "")
    if url and ccid:
        # Ack Vobiz fast; the auth-walled download + MinIO re-host runs after the response.
        background_tasks.add_task(_ingest_and_store_recording, ccid, url)
    return Response(status_code=204)


async def _ingest_and_store_recording(ccid: str, vobiz_url: str) -> None:
    """Pull the recording out from behind Vobiz auth into our public bucket, then point the
    record's recording_url at our own /recordings/{ccid} proxy (browser-playable, no auth).
    Handles BOTH a test session and a campaign contact, since /answer is shared by both."""
    ok = await ingest_vobiz_recording(vobiz_url, ccid)
    # On success serve via our proxy; on failure keep the raw URL so the link isn't lost.
    final_url = f"{PUBLIC_URL}/recordings/{ccid}" if ok else vobiz_url
    try:
        rid = uuid.UUID(ccid)
    except ValueError:
        return
    async with AsyncSessionLocal() as db:
        ts = await db.get(TestSession, rid)
        if ts:
            ts.recording_url = final_url
            await db.commit()
            return
        cc = await db.get(CampaignContact, rid)
        if cc:
            cc.recording_url = final_url
            await db.commit()


@app.get("/recordings/{ccid}")
async def serve_recording(ccid: str):
    """Stream a re-hosted call recording from MinIO. Same-origin + audio/wav, so the
    frontend <audio> tag plays it directly — no Vobiz X-Auth-* headers needed."""
    try:
        uuid.UUID(ccid)   # guard the SPA catch-all from arbitrary paths
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid recording id")
    data = await get_recording_bytes(ccid)
    if data is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    return Response(content=data, media_type="audio/wav")

@app.post("/hangup")
async def hangup(ccid: str = ""):
    await _campaign_hangup(ccid)     # campaign calls: release slot if it rang out unanswered
    pending_calls.pop(ccid, None)    # one-off /call test: drop stale meta
    return Response(status_code=204)

@app.websocket("/ws")
async def vobiz_ws(websocket: WebSocket):
    await websocket.accept()
    ccid = websocket.query_params.get("ccid", "")
    print(f"[/ws] OPEN ccid={ccid}", flush=True)
    meta = pending_calls.pop(ccid, None)
    print(f"[/ws] meta_found={meta is not None}", flush=True)
    if meta is None:
        await websocket.close(code=1011)
        return
    try:
        await voice_bot.run_phone_bot(websocket, meta)
    except Exception as e:
        import traceback
        print(f"[/ws] CRASH: {e}\n{traceback.format_exc()}", flush=True)
        raise
    finally:
        print(f"[/ws] CLOSED ccid={ccid}", flush=True)


@app.post("/call")
async def call_phone(req: CallRequest, db: AsyncSession = Depends(get_db)):
    agent_cfg = await _require_agent(req.agent, db)
    phone = req.phone.strip().replace(" ", "").replace("-", "")
    if not phone.startswith("+") or not phone[1:].isdigit():
        raise HTTPException(status_code=400, detail="Phone number must be in E.164 format, e.g. +917708139259")

    ts = TestSession(mode="phone", agent_workflow=req.agent,
                     agent_name=agent_cfg.get("agent_name", ""), phone=phone)
    db.add(ts)
    await db.commit()
    ccid = str(ts.id)   # the test_session_id IS the ccid threaded through Vobiz

    pending_calls[ccid] = {
        "phone_number": phone, "contact_name": "", "agent": agent_cfg,
        "context": {}, "master_fields": [], "focus": [],
        "campaign": {"campaign_contact_id": ccid, "report_url": f"{SERVER_BASE}/test"},
    }
    try:
        await _dial_vobiz(phone, ccid)
        print(f"[/call] vobiz dialing {phone} (ccid={ccid})")
    except Exception as e:
        pending_calls.pop(ccid, None)
        print(f"[/call] dial FAILED: {e}")
        raise HTTPException(status_code=500, detail=f"Vobiz dial failed: {e}")
    return {"mode": "phone", "phone": phone, "ccid": ccid, "test_session_id": ccid}

# ===========================================================================
# Test Session History — browser/phone test runs are persisted so they show up
# in the UI. The bot reports through the SAME machinery as campaigns (it posts
# {campaign_contact_id, ...} to {report_url}/{status,transcript,report}); for a
# test call, report_url is f"{SERVER_BASE}/test" and campaign_contact_id is the
# test_session_id — so no agent.py change is needed.
# ===========================================================================

@app.post("/test/status")
async def test_status(req: TestStatusRequest, db: AsyncSession = Depends(get_db)):
    try:
        ts = await db.get(TestSession, uuid.UUID(req.campaign_contact_id))
    except ValueError:
        return {"ok": True}
    if ts and req.status:
        # bot sends "Answered"/"Calling" (campaign vocab) → store lowercased for the test UI
        ts.status = req.status.lower()
        await db.commit()
    return {"ok": True}

@app.post("/test/transcript")
async def test_transcript(req: TestTranscriptRequest, db: AsyncSession = Depends(get_db)):
    try:
        ts = await db.get(TestSession, uuid.UUID(req.campaign_contact_id))
    except ValueError:
        return {"ok": True}
    if ts:
        lines = list(ts.transcript or [])
        lines.append({"role": req.role, "text": req.text, "ts": time.time()})
        ts.transcript = lines   # reassign so the JSONB change is tracked
        await db.commit()
    return {"ok": True}

@app.post("/test/report")
async def test_report(req: TestReportRequest, db: AsyncSession = Depends(get_db)):
    try:
        ts = await db.get(TestSession, uuid.UUID(req.campaign_contact_id))
    except ValueError:
        return {"ok": True}
    if not ts:
        return {"ok": True}
    # Map the bot's terminal status ("Finished"/"No Answer"/"Failed") to the test vocab.
    ts.status = (req.status or "finished").lower()
    if req.summary:
        ts.summary = req.summary
    if req.collected:
        ts.collected = req.collected
    await db.commit()
    return {"ok": True}

@app.post("/test/recording")
async def test_recording(req: TestRecordingRequest, db: AsyncSession = Depends(get_db)):
    try:
        ts = await db.get(TestSession, uuid.UUID(req.campaign_contact_id))
    except ValueError:
        return {"ok": True}
    if not ts:
        raise HTTPException(status_code=404, detail="Test session not found")
    ts.recording_url = req.recording_url
    ts.recording_egress_id = req.egress_id
    await db.commit()
    return {"ok": True}

@app.post("/test/metrics")
async def test_metrics(req: TestMetricsRequest, db: AsyncSession = Depends(get_db)):
    try:
        ts = await db.get(TestSession, uuid.UUID(req.campaign_contact_id))
    except ValueError:
        return {"ok": True}
    if not ts:
        return {"ok": True}
    ts.stt_audio_seconds     = req.stt_audio_seconds
    ts.llm_prompt_tokens     = req.llm_prompt_tokens
    ts.llm_completion_tokens = req.llm_completion_tokens
    ts.tts_characters        = req.tts_characters
    ts.turns                 = req.turns
    ts.duration_seconds      = req.duration_seconds
    ts.ttft_samples          = req.ttft_samples or []
    await db.commit()
    return {"ok": True}

@app.get("/test/sessions")
async def list_test_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestSession).order_by(TestSession.created_at.desc()))
    sessions = result.scalars().all()
    return {
        "sessions": [
            {
                "id": str(s.id), "mode": s.mode,
                "agent_workflow": s.agent_workflow, "agent_name": s.agent_name,
                "phone": s.phone, "status": s.status,
                "has_summary": bool(s.summary), "has_transcript": bool(s.transcript),
                "has_recording": bool(s.recording_url),
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in sessions
        ]
    }

def _compute_call_metrics(s) -> dict:
    stt_seconds = s.stt_audio_seconds or 0
    p_tok = s.llm_prompt_tokens or 0
    c_tok = s.llm_completion_tokens or 0
    chars = s.tts_characters or 0

    stt_cost = (stt_seconds / 60.0) * STT_USD_PER_MINUTE
    llm_cost = (p_tok / 1_000_000) * LLM_USD_PER_1M_PROMPT + (c_tok / 1_000_000) * LLM_USD_PER_1M_COMPLETE
    tts_cost = (chars / 1_000_000) * TTS_USD_PER_1M_CHARS

    samples = s.ttft_samples or []
    avg_lat = round(sum(samples) / len(samples), 3) if samples else 0.0
    peak_lat = round(max(samples), 3) if samples else 0.0

    return {
        "stt": {"seconds": round(stt_seconds, 2), "cost": round(stt_cost, 6), "estimated": True},
        "llm": {"prompt_tokens": p_tok, "completion_tokens": c_tok,
                "total_tokens": p_tok + c_tok, "cost": round(llm_cost, 6)},
        "tts": {"characters": chars, "cost": round(tts_cost, 6)},
        "total_cost": round(stt_cost + llm_cost + tts_cost, 6),
        "turns": s.turns or 0,
        "duration_seconds": round(s.duration_seconds or 0, 2),
        "avg_latency": avg_lat,
        "peak_latency": peak_lat,
    }

@app.get("/test/session/{test_session_id}")
async def get_test_session(test_session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        sid = uuid.UUID(test_session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid test session id")
    s = await db.get(TestSession, sid)
    if not s:
        raise HTTPException(status_code=404, detail="No such test session")
    return {
        "id": str(s.id), "mode": s.mode,
        "agent_workflow": s.agent_workflow, "agent_name": s.agent_name,
        "phone": s.phone, "status": s.status,
        "summary": s.summary or "", "transcript": s.transcript or [],
        "recording_url": s.recording_url or "",
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "metrics": _compute_call_metrics(s),
    }

@app.delete("/test/session/{test_session_id}")
async def delete_test_session(test_session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        sid = uuid.UUID(test_session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid test session id")
    s = await db.get(TestSession, sid)
    if s:
        await db.delete(s)
        await db.commit()
    return {"ok": True, "deleted": bool(s)}

# ===========================================================================
# Agents (workflows) — user-created agent configs, in-memory only.
# A campaign assigns one workflow; the agent uses its config for every call.
# ===========================================================================

class DataField(BaseModel):
    name: str
    example: str = ""


class CallerPersona(BaseModel):
    name: str
    description: str = ""


class ObjectionRule(BaseModel):
    objection: str
    response: str = ""


class AgentConfig(BaseModel):
    # --- Basic information ---
    workflow_name: str           # unique id, selectable when creating a campaign
    agent_name: str              # name the agent introduces itself with
    agent_role: str = ""         # short role descriptor (required)
    # --- Instructions ---
    instruction_prompt: str      # behavior / role / purpose
    negative_instructions: str = ""
    # --- Personality ---
    persona: str = ""
    tone: list[str] = []         # e.g. ["Calm", "Clear"]
    communication_style: str = ""
    # --- Conversation setup ---
    greeting: str                # how the agent opens
    sign_off: str                # how the agent closes
    conversation_flow: str = ""
    # --- Business knowledge ---
    knowledge_context: str = ""
    # --- Routing & control ---
    outcomes: list[str] = []     # outcomes the agent can produce (workflows route on these)
    handoff_rules: str = ""
    safety_rules: str = ""
    # --- Optional configuration ---
    data_fields: list[DataField] = []           # info to collect during the call
    caller_personas: list[CallerPersona] | None = None
    objection_rules: list[ObjectionRule] | None = None


# Required free-text fields for an agent → label shown if missing.
_REQUIRED_AGENT_TEXT = {
    "agent_name": "Agent Name",
    "agent_role": "Agent Role",
    "instruction_prompt": "Instruction Prompt",
    "negative_instructions": "Negative Instructions",
    "persona": "Persona",
    "communication_style": "Communication Style",
    "greeting": "Greeting",
    "sign_off": "Sign Off",
    "conversation_flow": "Conversation Flow",
    "knowledge_context": "Knowledge Context",
    "handoff_rules": "Handoff Rules",
    "safety_rules": "Safety Rules",
}


def _apply_agent_fields(agent: Agent, cfg: AgentConfig) -> None:
    """Copy every editable field from the request onto the ORM row (create & update)."""
    agent.agent_name = cfg.agent_name
    agent.agent_role = cfg.agent_role
    agent.instruction_prompt = cfg.instruction_prompt
    agent.negative_instructions = cfg.negative_instructions
    agent.persona = cfg.persona
    agent.tone = cfg.tone
    agent.communication_style = cfg.communication_style
    agent.greeting = cfg.greeting
    agent.sign_off = cfg.sign_off
    agent.conversation_flow = cfg.conversation_flow
    agent.knowledge_context = cfg.knowledge_context
    agent.outcomes = cfg.outcomes
    agent.handoff_rules = cfg.handoff_rules
    agent.safety_rules = cfg.safety_rules
    agent.data_fields = [f.model_dump() for f in cfg.data_fields]
    agent.caller_personas = [p.model_dump() for p in cfg.caller_personas] if cfg.caller_personas else None
    agent.objection_rules = [r.model_dump() for r in cfg.objection_rules] if cfg.objection_rules else None


def _agent_to_api(a: Agent) -> dict:
    """Full agent record for the Create Agent CRUD responses (NOT the runtime cfg)."""
    return {
        "workflow_name": a.workflow_name,
        "agent_name": a.agent_name,
        "agent_role": a.agent_role,
        "instruction_prompt": a.instruction_prompt,
        "negative_instructions": a.negative_instructions,
        "persona": a.persona,
        "tone": a.tone,
        "communication_style": a.communication_style,
        "greeting": a.greeting,
        "sign_off": a.sign_off,
        "conversation_flow": a.conversation_flow,
        "knowledge_context": a.knowledge_context,
        "outcomes": a.outcomes,
        "handoff_rules": a.handoff_rules,
        "safety_rules": a.safety_rules,
        "data_fields": a.data_fields,
        "caller_personas": a.caller_personas or [],
        "objection_rules": a.objection_rules or [],
    }


@app.post("/agents")
async def save_agent(cfg: AgentConfig, db: AsyncSession = Depends(get_db)):
    wf = cfg.workflow_name.strip()
    if not wf:
        raise HTTPException(status_code=400, detail="Agent Workflow Name is required.")

    # Required free-text fields must be non-empty.
    for attr, label in _REQUIRED_AGENT_TEXT.items():
        if not (getattr(cfg, attr) or "").strip():
            raise HTTPException(status_code=400, detail=f"{label} is required.")

    # Required list fields must have at least one entry.
    if not cfg.tone:
        raise HTTPException(status_code=400, detail="Select at least one Tone.")
    if not cfg.outcomes:
        raise HTTPException(status_code=400, detail="Add at least one Outcome.")

    existing = await db.get(Agent, wf)
    if existing:
        _apply_agent_fields(existing, cfg)
        await db.commit()
        return {"ok": True, "workflow_name": wf, "updated": True}

    agent = Agent(workflow_name=wf)
    _apply_agent_fields(agent, cfg)
    db.add(agent)
    await db.commit()
    return {"ok": True, "workflow_name": wf, "created": True}


@app.get("/agents")
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).order_by(Agent.workflow_name))
    return {"agents": [_agent_to_api(a) for a in result.scalars().all()]}


@app.get("/agents/{workflow_name}")
async def get_agent(workflow_name: str, db: AsyncSession = Depends(get_db),):
    agent = await db.get(
        Agent,
        workflow_name,
    )

    if not agent:
        raise HTTPException(
            status_code=404,
            detail="No such agent workflow",
        )

    return _agent_to_api(agent)


@app.delete("/agents/{workflow_name}")
async def delete_agent(workflow_name: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, workflow_name)
    if not agent:
        return {"ok": True, "deleted": False}
    await db.delete(agent)
    await db.commit()
    return {"ok": True, "deleted": True}


# ===========================================================================
# Contacts — a reusable master list, independent of campaigns. In-memory only.
# ===========================================================================


def _normalize_phone(raw: str) -> str | None:
    """Return an E.164 phone (+digits, 7-15 digits) or None if invalid."""
    p = (raw or "").strip().replace(" ", "").replace("-", "")
    if p.startswith("+") and p[1:].isdigit() and 7 <= len(p[1:]) <= 15:
        return p
    return None
 
 
_HEADER_WORDS = {
    "name", "contact", "contact name", "full name",
    "mobile", "mobile number", "number", "phone", "phone number",
}
 
 
class ContactUpload(BaseModel):
    csv: str
    tags: list[str] = []
 
 
@app.post("/contacts/upload")
async def contacts_upload(req: ContactUpload, db: AsyncSession = Depends(get_db)):
    tags = [t.strip() for t in req.tags if t.strip()]
    if not tags:
        raise HTTPException(status_code=400, detail="Assign at least one tag.")
 
    added = 0
    updated = 0
    invalid: list[str] = []
 
    for raw in csv.reader(io.StringIO(req.csv)):
        # Skip blank rows.
        if not raw or all(not (cell or "").strip() for cell in raw):
            continue
 
        name = (raw[0] if len(raw) > 0 else "").strip()
        phone_raw = (raw[1] if len(raw) > 1 else "").strip()
 
        # Skip header rows: if EITHER column looks like a header label, it's a header.
        # (A real data row never has a header word in the name OR phone column, and a
        #  valid phone never matches a header word — so this can't drop real contacts.)
        if name.lower() in _HEADER_WORDS or phone_raw.lower() in _HEADER_WORDS:
            continue
 
        phone = _normalize_phone(phone_raw)
        if not phone:
            invalid.append(f"{name or '(no name)'}: {phone_raw or '(no number)'}")
            continue
 
        result = await db.execute(select(Contact).where(Contact.phone == phone))
        existing = result.scalar_one_or_none()
 
        if existing:
            # Merge new tags into the existing set; fill in a name only if we don't have one.
            merged_tags = set(existing.tags or [])
            merged_tags.update(tags)
            existing.tags = list(merged_tags)
            if name and existing.name in ("", "(unknown)"):
                existing.name = name
            updated += 1
        else:
            db.add(Contact(name=name or "(unknown)", phone=phone, tags=tags))
            added += 1
 
    await db.commit()
 
    total = (await db.execute(select(func.count(Contact.id)))).scalar_one()
    return {"added": added, "updated": updated, "invalid": invalid, "total": total}
 
 
@app.get("/contacts")
async def list_contacts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contact).order_by(Contact.name))
    contacts = result.scalars().all()
    return {
        "contacts": [
            {"id": str(c.id), "name": c.name, "phone": c.phone, "tags": c.tags}
            for c in contacts
        ]
    }
 
 
@app.get("/contacts/tags")
async def list_contact_tags(db: AsyncSession = Depends(get_db)):
    # Needs every row to union the tag sets, so a full scan is unavoidable here.
    result = await db.execute(select(Contact))
    contacts = result.scalars().all()
    tags: set[str] = set()
    for contact in contacts:
        tags.update(contact.tags or [])
    return {"tags": sorted(tags)}

def _validate_indian_mobile(raw: str) -> str | None:
    """Return E.164 +91XXXXXXXXXX if valid Indian mobile, else None."""
    p = (raw or "").strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not p.startswith("+91"):
        return None
    digits = p[3:]
    if len(digits) != 10 or not digits.isdigit() or digits[0] not in "6789":
        return None
    return p


class ContactCreate(BaseModel):
    name: str
    phone: str
    tags: list[str] = []


def _dedup_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for t in tags:
        t = t.strip()
        if t and t not in seen:
            seen.add(t)
            result.append(t)
    return result


@app.post("/contacts")
async def create_contact(req: ContactCreate, db: AsyncSession = Depends(get_db)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    phone = _validate_indian_mobile(req.phone)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid Indian mobile number starting with +91 followed by 10 digits (e.g. +919876543210).",
        )

    tags = _dedup_tags(req.tags)
    if len(tags) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 tags allowed per contact.")

    result = await db.execute(select(Contact).where(Contact.phone == phone))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A contact with this number already exists ({existing.name}). Use Edit to update them.",
        )

    contact = Contact(name=name, phone=phone, tags=tags)
    db.add(contact)
    await db.commit()
    return {"id": str(contact.id), "name": contact.name, "phone": contact.phone, "tags": contact.tags}


@app.put("/contacts/{cid}")
async def update_contact(cid: str, req: ContactCreate, db: AsyncSession = Depends(get_db)):
    try:
        contact = await db.get(Contact, uuid.UUID(cid))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid contact id.")
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found.")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    phone = _validate_indian_mobile(req.phone)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid Indian mobile number starting with +91 followed by 10 digits (e.g. +919876543210).",
        )

    tags = _dedup_tags(req.tags)
    if len(tags) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 tags allowed per contact.")

    if phone != contact.phone:
        result = await db.execute(select(Contact).where(Contact.phone == phone))
        taken = result.scalar_one_or_none()
        if taken:
            raise HTTPException(
                status_code=409,
                detail=f"This number is already used by another contact ({taken.name}).",
            )

    contact.name = name
    contact.phone = phone
    contact.tags = tags
    await db.commit()
    return {"id": str(contact.id), "name": contact.name, "phone": contact.phone, "tags": contact.tags}
 
 
@app.delete("/contacts/{cid}")
async def delete_contact(cid: str, db: AsyncSession = Depends(get_db)):
    try:
        contact = await db.get(Contact, uuid.UUID(cid))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid contact id")
    if not contact:
        return {"ok": True, "deleted": False}
    await db.delete(contact)
    await db.commit()
    return {"ok": True, "deleted": True}
 
 
# ===========================================================================
# Workflows — routing config: an ordered set of stages (agent + outcome rules).
# The workflow decides the next agent; agents only produce outcomes.
# ===========================================================================
 
class RoutingRule(BaseModel):
    target: str                            # agent workflow_name | "END" | "HUMAN_TRANSFER"
    retry_after_days: float | None = None
 
 
class WorkflowStage(BaseModel):
    agent: str                             # agent workflow_name
    routing: dict[str, RoutingRule] = {}   # outcome -> rule
    focus: list[str] = []                  # field names (from the catalog) this stage leads on
 
 
class WorkflowConfig(BaseModel):
    name: str
    stages: list[WorkflowStage] = []
    data_fields: list[DataField] = []      # master catalog collected across the whole journey
 
 
_ROUTING_SPECIALS = {"END", "HUMAN_TRANSFER"}
 
 
@app.post("/workflows")
async def save_workflow(cfg: WorkflowConfig, db: AsyncSession = Depends(get_db)):
    name = cfg.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workflow Name is required.")
    if not cfg.stages:
        raise HTTPException(status_code=400, detail="Add at least one stage.")
 
    # Validate every stage agent + every routing target resolves to a real agent now,
    # so a typo/deleted agent fails HERE with a clear message instead of mid-campaign
    # in _pump() (where db.get(Agent, ...) would return None and crash the dial).
    for i, st in enumerate(cfg.stages, 1):
        if not st.agent:
            raise HTTPException(status_code=400, detail=f"Stage {i}: select an agent.")
        if not await db.get(Agent, st.agent):
            raise HTTPException(status_code=400, detail=f"Stage {i}: agent '{st.agent}' doesn't exist.")
        for outcome, rule in st.routing.items():
            if rule.target not in _ROUTING_SPECIALS and not await db.get(Agent, rule.target):
                raise HTTPException(
                    status_code=400,
                    detail=f"Stage {i}, outcome '{outcome}': target '{rule.target}' doesn't exist.",
                )
 
    stages_data = [stage.model_dump() for stage in cfg.stages]
 
    # Master catalog of fields to collect across the whole workflow.
    fields_data = [f.model_dump() for f in cfg.data_fields if f.name.strip()]
    # Keep each stage's focus limited to fields that exist in the master catalog.
    field_names = {f["name"] for f in fields_data}
    for st in stages_data:
        st["focus"] = [n for n in st.get("focus", []) if n in field_names]
 
    existing = await db.get(Workflow, name)
    if existing:
        existing.stages = stages_data
        existing.data_fields = fields_data
        await db.commit()
        return {"ok": True, "name": name, "updated": True}
 
    db.add(Workflow(name=name, stages=stages_data, data_fields=fields_data))
    await db.commit()
    return {"ok": True, "name": name, "created": True}
 
 
@app.get("/workflows")
async def list_workflows(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow).order_by(Workflow.name))
    workflows = result.scalars().all()
    return {
        "workflows": [
            {"name": wf.name, "stages": wf.stages, "data_fields": wf.data_fields}
            for wf in workflows
        ]
    }
 
 
@app.get("/workflows/{name}")
async def get_workflow(name: str, db: AsyncSession = Depends(get_db)):
    workflow = await db.get(Workflow, name)
    if not workflow:
        raise HTTPException(status_code=404, detail="No such workflow")
    return {"name": workflow.name, "stages": workflow.stages, "data_fields": workflow.data_fields}
 
 
@app.delete("/workflows/{name}")
async def delete_workflow(name: str, db: AsyncSession = Depends(get_db)):
    workflow = await db.get(Workflow, name)
    if not workflow:
        return {"ok": True, "deleted": False}
    await db.delete(workflow)
    await db.commit()
    return {"ok": True, "deleted": True}

# ===========================================================================
# Bulk-call campaigns — engine state is in memory (lost on restart, by design);
# durable contact/campaign state lives in the DB.
#
# CALL LIFECYCLE (the active-slot is the concurrency guard — only ONE call in flight):
#   _pump            claims the slot, dials Vobiz, stashes meta in pending_calls
#   bot answered     → /campaign/report → _finalize_contact (routes + releases slot)
#   ring no-answer   → Vobiz /hangup → _campaign_hangup → _finalize_contact("No Answer")
#   stuck/no report  → watchdog (_check_active_timeout) → _finalize_contact("Failed")
#   dial failed      → _pump's except → mark FAILED + release slot
# Every path ends by releasing the slot, so the campaign can never freeze on one contact.
#
# Requires at top of server.py:  from loguru import logger
# ===========================================================================

# Simulated/accelerated retry clock: one "day" of retry delay == this many seconds.
RETRY_DAY_SECONDS = float(os.getenv("RETRY_DAY_SECONDS", "10"))
MAX_ATTEMPTS = 6   # safety cap per contact, so retry loops can't run forever

# Watchdog: if a call holds the active slot longer than this with no terminal report,
# force it terminal so the campaign advances. Generous — real calls finish well under this.
MAX_CALL_SECONDS = float(os.getenv("MAX_CALL_SECONDS", "600"))

# Terminal statuses end a call; interim ones don't.
TERMINAL_STATUSES = {"Finished", "No Answer", "Failed"}
INTERIM_STATUSES = {"Calling", "Answered"}


class CreateRequest(BaseModel):
    name: str
    workflow: str
    contact_ids: list[str] = []


class StatusRequest(BaseModel):
    campaign_contact_id: str
    status: str


class ReportRequest(BaseModel):
    campaign_contact_id: str
    status: str
    summary: str = ""
    collected: dict = {}
    outcome: str = ""
    callback_in_days: float | None = None
    callback_note: str = ""


class TranscriptRequest(BaseModel):
    campaign_contact_id: str
    role: str
    text: str


class RecordingRequest(BaseModel):
    campaign_contact_id: str
    recording_url: str
    egress_id: str = ""


class CampaignEngine:
    def __init__(self):
        self.running_campaign_id: uuid.UUID | None = None
        self.active_contact_id: uuid.UUID | None = None
        self.active_since: float = 0.0   # when the active call claimed the slot (watchdog clock)
        self.jobs: list[dict] = []       # [{"contact_id": UUID, "agent": str, "due_at": float}]
        self.paused: bool = False        # when True, in-flight call finishes but no new dials
        self.lock = asyncio.Lock()
        self.task: asyncio.Task | None = None

    def reset(self):
        if self.task:
            self.task.cancel()
            self.task = None
        self.running_campaign_id = None
        self.active_contact_id = None
        self.active_since = 0.0
        self.jobs = []
        self.paused = False


campaign_engine = CampaignEngine()


# ---- routing helpers operate on a stages list pulled from the DB ----
def _entry_agent(stages: list[dict]) -> str | None:
    return stages[0]["agent"] if stages else None


def _routing_for(stages: list[dict], agent: str) -> dict:
    for s in stages:
        if s.get("agent") == agent:
            return s.get("routing", {})
    return {}


def _stage_label(stages: list[dict], agent: str, agent_names: dict[str, str]) -> str:
    for i, s in enumerate(stages, 1):
        if s.get("agent") == agent:
            return f"Stage {i}: {agent_names.get(agent, agent)}"
    return agent or "—"


# ---------------------------------------------------------------------------
# Shared finalizer — the single place a contact is routed to its next stage,
# retried, transferred, or completed, AND the single place the active slot is
# released. Called by /campaign/report (answered calls), /hangup (no-answer),
# and the watchdog (stuck calls), so all three apply identical routing.
# ---------------------------------------------------------------------------
async def _finalize_contact(
    db: AsyncSession,
    contact: CampaignContact,
    *,
    status: str,
    outcome: str = "",
    summary: str = "",
    collected: dict | None = None,
    callback_in_days: float | None = None,
    callback_note: str = "",
) -> None:
    status_val = status if status in TERMINAL_STATUSES else "Failed"
    contact.status = ContactStatus(status_val)   # value-based lookup -> enum member

    if summary:
        contact.summary = summary
    if collected:
        # Accumulate across stages WITHOUT letting a later stage's blank extraction clobber a
        # value an earlier stage captured. Overwrite only with a non-empty value; otherwise keep.
        merged = dict(contact.collected or {})
        for k, v in collected.items():
            if k not in merged or v not in (None, ""):
                merged[k] = v
        contact.collected = merged
    if callback_note:
        contact.callback_note = callback_note

    norm = (outcome or "").strip().upper().replace(" ", "_")
    if not norm:
        norm = {"No Answer": "NO_ANSWER", "Failed": "FAILED"}.get(status_val, "")
    contact.last_outcome = norm

    history = list(contact.stages_history or [])
    history.append({"agent": contact.current_agent, "outcome": norm, "summary": contact.summary})
    contact.stages_history = history

    campaign = await db.get(Campaign, contact.campaign_id)
    workflow = await db.get(Workflow, campaign.workflow_name) if campaign else None
    stages = workflow.stages if workflow else []
    stage_agents = [s["agent"] for s in stages]

    rule = _routing_for(stages, contact.current_agent).get(norm)
    target = rule.get("target") if rule else "END"

    if target in stage_agents and contact.attempts < MAX_ATTEMPTS:
        delay_days = (callback_in_days
                      if callback_in_days not in (None, 0)
                      else (rule.get("retry_after_days") or 0))
        tgt = await db.get(Agent, target)
        label = _stage_label(stages, target, {target: tgt.agent_name if tgt else target})
        contact.current_agent = target
        contact.current_stage = (f"Retry → {label} (~{delay_days}d)"
                                 if delay_days else f"Next → {label}")
        due_at = time.time() + float(delay_days) * RETRY_DAY_SECONDS
        async with campaign_engine.lock:
            campaign_engine.jobs.append({"contact_id": contact.id, "agent": target, "due_at": due_at})

    elif target == "HUMAN_TRANSFER":
        db.add(HumanTransfer(
            name=contact.name, phone=contact.phone,
            workflow_name=campaign.workflow_name if campaign else "",
            final_outcome=norm, collected=contact.collected or {},
            summary=contact.summary or "", campaign_id=contact.campaign_id,
        ))
        contact.final_outcome = norm
        contact.current_stage = "Human Transfer"
        contact.done = True

    else:  # END / unknown target
        contact.final_outcome = norm or contact.status.value
        contact.current_stage = "Completed"
        contact.done = True

    await db.commit()

    # Release the active slot so the loop can dial the next contact. (Retry jobs were
    # appended above, so the queue is already non-empty before we release.)
    async with campaign_engine.lock:
        if campaign_engine.active_contact_id == contact.id:
            campaign_engine.active_contact_id = None
            campaign_engine.active_since = 0.0

    # Buying-intent scoring runs in the background only for calls with a real conversation.
    if status_val == "Finished" and contact.transcript:
        asyncio.create_task(_score_buying_intent_bg(contact.id))


async def _campaign_hangup(ccid: str) -> None:
    """Vobiz /hangup webhook for a campaign call. Finalize ONLY calls that rang out without
    being answered (status still CALLING) — answered calls are finalized by the bot via
    /campaign/report, with the watchdog as backstop. No-op for everything else, so this never
    races a real report (an answered call's status flips to ANSWERED on connect, long before
    the end-of-call hangup fires)."""
    try:
        contact_id = uuid.UUID(ccid)
    except ValueError:
        return
    async with campaign_engine.lock:
        if campaign_engine.active_contact_id != contact_id:
            return  # report already advanced us, or this isn't our active call
    async with AsyncSessionLocal() as db:
        contact = await db.get(CampaignContact, contact_id)
        if not contact or contact.done:
            return
        if contact.status != ContactStatus.CALLING:
            return  # answered → bot's report / watchdog owns this
        pending_calls.pop(ccid, None)          # a late WS would now get meta=None and close
        await _finalize_contact(db, contact, status="No Answer")


async def _check_active_timeout() -> None:
    """Watchdog backstop: if the active call has held the slot past MAX_CALL_SECONDS with no
    terminal report (bot crashed, WS dropped, /hangup never arrived), force it terminal so the
    campaign advances instead of freezing on one contact."""
    async with campaign_engine.lock:
        active_id = campaign_engine.active_contact_id
        since = campaign_engine.active_since
    if active_id is None or not since or (time.time() - since) < MAX_CALL_SECONDS:
        return
    logger.warning(f"[campaign] watchdog: contact {active_id} active >{MAX_CALL_SECONDS:.0f}s "
                   f"with no report — forcing terminal")
    pending_calls.pop(str(active_id), None)
    async with AsyncSessionLocal() as db:
        contact = await db.get(CampaignContact, active_id)
        if contact and not contact.done:
            await _finalize_contact(db, contact, status="Failed")
    # _finalize_contact releases the slot when it matches; ensure it's clear regardless.
    async with campaign_engine.lock:
        if campaign_engine.active_contact_id == active_id:
            campaign_engine.active_contact_id = None
            campaign_engine.active_since = 0.0


async def _campaign_loop():
    """Background task: pump one call at a time until the queue drains, then mark DONE."""
    try:
        while True:
            async with campaign_engine.lock:
                if campaign_engine.running_campaign_id is None:
                    return
                cid = campaign_engine.running_campaign_id
                done = campaign_engine.active_contact_id is None and not campaign_engine.jobs
            if done:
                async with AsyncSessionLocal() as db:
                    camp = await db.get(Campaign, cid)
                    if camp:
                        camp.status = CampaignStatus.DONE
                        await db.commit()
                async with campaign_engine.lock:
                    campaign_engine.running_campaign_id = None
                return
            await _check_active_timeout()   # backstop before trying to dial the next one
            await _pump()
            await asyncio.sleep(0.5)
    except asyncio.CancelledError:
        pass


async def _pump():
    """If no call is active, dial (via Vobiz) the earliest job whose due time has arrived."""
    async with campaign_engine.lock:
        if (campaign_engine.running_campaign_id is None
                or campaign_engine.paused
                or campaign_engine.active_contact_id is not None):
            return
        now = time.time()
        due = sorted([j for j in campaign_engine.jobs if j["due_at"] <= now],
                     key=lambda j: j["due_at"])
        if not due:
            return
        job = due[0]
        campaign_engine.jobs.remove(job)
        contact_id, agent_wf = job["contact_id"], job["agent"]
        campaign_engine.active_contact_id = contact_id   # hold the slot before releasing the lock
        campaign_engine.active_since = time.time()       # start the watchdog clock

    # DB work + dial happen outside the engine lock; the active slot guards concurrency.
    async with AsyncSessionLocal() as db:
        contact = await db.get(CampaignContact, contact_id)
        if not contact:
            async with campaign_engine.lock:
                campaign_engine.active_contact_id = None
                campaign_engine.active_since = 0.0
            return
        agent = await db.get(Agent, agent_wf)
        camp = await db.get(Campaign, contact.campaign_id)
        wf = await db.get(Workflow, camp.workflow_name) if camp else None
        stages = wf.stages if wf else []

        # Warm resume: a contact still CALLING/ANSWERED at dial time was interrupted mid-call
        # (e.g. a restart during its call). Carry the partial transcript of that interrupted
        # stage so the agent continues the conversation instead of starting over.
        prev_stage_no = contact.attempts or 0
        partial_transcript = (
            [
                {"role": l.get("role"), "text": l.get("text")}
                for l in (contact.transcript or [])
                if l.get("stage_no") == prev_stage_no and (l.get("text") or "").strip()
            ]
            if contact.status in (ContactStatus.CALLING, ContactStatus.ANSWERED)
            else []
        )
        resuming = bool(partial_transcript)

        contact.status = ContactStatus.CALLING
        contact.current_agent = agent_wf
        contact.current_stage = _stage_label(
            stages, agent_wf, {agent_wf: agent.agent_name if agent else agent_wf}
        )
        contact.attempts = (contact.attempts or 0) + 1

        context = {
            "collected": dict(contact.collected or {}),
            "previous_summary": contact.summary or "",
            "previous_stages": contact.stages_history or [],
            "callback_note": contact.callback_note or "",
            "resuming": resuming,
            "partial_transcript": partial_transcript,
        }
        master_fields = wf.data_fields if wf else []
        stage_focus = next(
            (s.get("focus", []) for s in stages if s.get("agent") == agent_wf), []
        )

        ccid = str(contact.id)   # campaign_contact_id IS the ccid threaded through Vobiz
        # meta is a DICT (not json.dumps) — /ws pops this straight from pending_calls and
        # run_phone_bot consumes it; same envelope shape the one-off /call path uses.
        meta = {
            "phone_number": contact.phone,
            "contact_name": contact.name,
            "campaign": {
                "campaign_contact_id": ccid,
                "report_url": f"{SERVER_BASE}/campaign",
            },
            "agent": _agent_to_cfg(agent) if agent else None,
            "context": context,
            "master_fields": master_fields,
            "focus": stage_focus,
        }
        phone = contact.phone
        pending_calls[ccid] = meta
        await db.commit()

    # Dial Vobiz. On answer, Vobiz fetches /answer?ccid=…,
    # opens /ws?ccid=…, and run_phone_bot pops meta from pending_calls.
    try:
        await _dial_vobiz(phone, ccid)
        logger.info(f"[campaign] dialing {phone} (ccid={ccid})")
    except Exception as e:
        logger.error(f"[campaign] dial failed for {phone} (ccid={ccid}): {e}")
        pending_calls.pop(ccid, None)
        async with AsyncSessionLocal() as db:
            contact = await db.get(CampaignContact, contact_id)
            if contact:
                contact.status = ContactStatus.FAILED
                contact.final_outcome = "DISPATCH_FAILED"
                contact.current_stage = "Failed to dial"
                contact.done = True
                await db.commit()
        async with campaign_engine.lock:
            if campaign_engine.active_contact_id == contact_id:
                campaign_engine.active_contact_id = None
                campaign_engine.active_since = 0.0


@app.get("/campaigns")
async def list_campaigns(db: AsyncSession = Depends(get_db)):
    """All campaigns (any status) for the list page — not just the running one."""
    result = await db.execute(select(Campaign).order_by(Campaign.created_at.desc()))
    campaigns = result.scalars().all()
    out = []
    for c in campaigns:
        contacts = await _load_contacts(db, c.id)
        out.append({
            "campaign_id": str(c.id),
            "name": c.name,
            "workflow": c.workflow_name,
            "status": c.status.value,
            "running": campaign_engine.running_campaign_id == c.id and c.status == CampaignStatus.RUNNING,
            "total": len(contacts),
            "done": sum(1 for x in contacts if x.done),
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return {"campaigns": out}


@app.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, db: AsyncSession = Depends(get_db)):
    try:
        cid = uuid.UUID(campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid campaign id")
    camp = await db.get(Campaign, cid)
    if camp:
        if campaign_engine.running_campaign_id == cid:
            campaign_engine.reset()
        await db.delete(camp)   # cascade removes its campaign_contacts
        await db.commit()
    return {"ok": True}


@app.post("/campaign/create")
async def campaign_create(req: CreateRequest, db: AsyncSession = Depends(get_db)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Campaign Name is required.")

    workflow = await db.get(Workflow, req.workflow)
    if not workflow:
        raise HTTPException(status_code=400, detail="Select a valid Workflow.")
    if not workflow.stages:
        raise HTTPException(status_code=400, detail="The selected workflow has no stages.")

    result = await db.execute(
        select(Contact).where(Contact.id.in_([uuid.UUID(x) for x in req.contact_ids]))
    )
    contacts = result.scalars().all()
    if not contacts:
        raise HTTPException(status_code=400, detail="Select at least one contact.")

    campaign = Campaign(name=name, workflow_name=req.workflow)
    db.add(campaign)
    await db.flush()

    for i, contact in enumerate(contacts, start=1):
        db.add(CampaignContact(
            campaign_id=campaign.id, contact_id=contact.id, sno=i,
            name=contact.name, phone=contact.phone,
            status=ContactStatus.NOT_INITIATED,
            current_agent="", current_stage="", last_outcome="", final_outcome="",
            attempts=0, done=False,
            summary="", transcript=[], collected={}, stages_history=[], callback_note="",
        ))

    await db.commit()
    return {
        "campaign_id": str(campaign.id),
        "count": len(contacts),
        "campaign_name": name,
        "workflow": req.workflow,
    }


class StartCampaignRequest(BaseModel):
    campaign_id: str


@app.post("/campaign/start")
async def campaign_start(req: StartCampaignRequest, db: AsyncSession = Depends(get_db)):
    try:
        cid = uuid.UUID(req.campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid campaign id")

    campaign = await db.get(Campaign, cid)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status == CampaignStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Campaign already running")
    # Only one campaign may run at a time (single active-call engine).
    if campaign_engine.running_campaign_id is not None:
        raise HTTPException(status_code=400, detail="Another campaign is currently running.")

    workflow = await db.get(Workflow, campaign.workflow_name)
    if not workflow or not workflow.stages:
        raise HTTPException(status_code=400, detail="Workflow has no stages")
    entry = _entry_agent(workflow.stages)

    result = await db.execute(
        select(CampaignContact)
        .where(CampaignContact.campaign_id == campaign.id)
        .order_by(CampaignContact.sno)
    )
    contacts = result.scalars().all()
    if not contacts:
        raise HTTPException(status_code=400, detail="Campaign has no contacts")

    for c in contacts:
        c.status = ContactStatus.NOT_INITIATED
        c.current_agent = entry          # assign entry agent so routing can resolve later
        c.current_stage = "Queued"
        c.last_outcome = c.final_outcome = ""
        c.summary = c.callback_note = ""
        c.transcript = []
        c.collected = {}
        c.stages_history = []
        c.attempts = 0
        c.done = False

    campaign.status = CampaignStatus.RUNNING
    await db.commit()

    now = time.time()
    campaign_engine.reset()
    campaign_engine.running_campaign_id = campaign.id
    campaign_engine.jobs = [{"contact_id": c.id, "agent": entry, "due_at": now} for c in contacts]
    campaign_engine.task = asyncio.create_task(_campaign_loop())

    return {"ok": True, "campaign_id": str(campaign.id), "contacts": len(contacts)}


@app.post("/campaign/pause")
async def campaign_pause(req: StartCampaignRequest, db: AsyncSession = Depends(get_db)):
    """Pause: an in-flight call finishes normally, but no new calls are dialed. Persisted as
    PAUSED so it survives a restart; progress and contacts untouched."""
    try:
        cid = uuid.UUID(req.campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid campaign id")
    if campaign_engine.running_campaign_id != cid:
        raise HTTPException(status_code=400, detail="Campaign is not running.")
    async with campaign_engine.lock:
        campaign_engine.paused = True
    camp = await db.get(Campaign, cid)
    if camp:
        camp.status = CampaignStatus.PAUSED
        await db.commit()
    return {"ok": True, "paused": True}


@app.post("/campaign/resume")
async def campaign_resume(req: StartCampaignRequest, db: AsyncSession = Depends(get_db)):
    """Resume a paused campaign. If the engine still holds it (same process), lift the flag.
    Otherwise (e.g. after a restart) rebuild the queue from the DB — every not-done contact is
    re-enqueued at its current agent. No reset, no data loss."""
    try:
        cid = uuid.UUID(req.campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid campaign id")
    camp = await db.get(Campaign, cid)
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if camp.status not in (CampaignStatus.PAUSED, CampaignStatus.RUNNING):
        raise HTTPException(status_code=400, detail="Campaign is not paused.")

    if campaign_engine.running_campaign_id == cid:
        async with campaign_engine.lock:
            campaign_engine.paused = False
    else:
        if campaign_engine.running_campaign_id is not None:
            raise HTTPException(status_code=400, detail="Another campaign is currently running.")
        wf = await db.get(Workflow, camp.workflow_name)
        if not wf or not wf.stages:
            raise HTTPException(status_code=400, detail="Workflow has no stages.")
        entry = _entry_agent(wf.stages)
        result = await db.execute(
            select(CampaignContact).where(CampaignContact.campaign_id == cid).order_by(CampaignContact.sno)
        )
        pending = [c for c in result.scalars().all() if not c.done]
        now = time.time()
        campaign_engine.reset()
        campaign_engine.running_campaign_id = cid
        campaign_engine.jobs = [
            {"contact_id": c.id, "agent": (c.current_agent or entry), "due_at": now} for c in pending
        ]
        campaign_engine.task = asyncio.create_task(_campaign_loop())

    camp.status = CampaignStatus.RUNNING
    await db.commit()
    return {"ok": True, "paused": False}


@app.post("/campaign/stop")
async def campaign_stop(req: StartCampaignRequest, db: AsyncSession = Depends(get_db)):
    """Permanently end a campaign: halt the engine WITHOUT wiping data and mark it STOPPED so
    it can't be resumed. Contact execution state is preserved and stays viewable."""
    try:
        cid = uuid.UUID(req.campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid campaign id")
    camp = await db.get(Campaign, cid)
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign_engine.running_campaign_id == cid:
        campaign_engine.reset()
    camp.status = CampaignStatus.STOPPED
    await db.commit()
    return {"ok": True}


@app.post("/campaign/status")
async def campaign_status(req: StatusRequest, db: AsyncSession = Depends(get_db)):
    contact = await db.get(CampaignContact, uuid.UUID(req.campaign_contact_id))
    if not contact:
        raise HTTPException(status_code=404, detail="Campaign contact not found")
    if req.status in INTERIM_STATUSES:
        contact.status = ContactStatus(req.status)
        await db.commit()
    return {"ok": True}


@app.post("/campaign/transcript")
async def campaign_transcript(req: TranscriptRequest, db: AsyncSession = Depends(get_db)):
    contact = await db.get(CampaignContact, uuid.UUID(req.campaign_contact_id))
    if contact:
        lines = list(contact.transcript or [])
        # Tag each line with its execution so the Call Details page can split the transcript
        # per agent/stage. stage_no (= attempts) uniquely identifies each call.
        lines.append({
            "role": req.role,
            "text": req.text,
            "stage_no": contact.attempts or 0,
            "stage": contact.current_stage or "",
            "agent": contact.current_agent or "",
        })
        contact.transcript = lines   # reassign so the JSONB change is tracked
        await db.commit()
    return {"ok": True}


# ── Buying Intent Score ───────────────────────────────────────────────────────
async def _buying_intent(transcript: list, summary: str) -> tuple[int | None, str]:
    """Return (score 0-100, 3-line reason) from the transcript + summary, or (None, '')."""
    lines: list[str] = []
    for ln in (transcript or []):
        t = (ln.get("text") or "").strip()
        if t:
            lines.append(("Caller" if ln.get("role") == "user" else "Agent") + ": " + t)
    convo = "\n".join(lines)
    if not convo:
        return None, ""

    sys = (
        "You score how interested a customer is in BUYING, based only on a sales-call transcript "
        "and its summary. Weigh the customer's words, phrases, questions, urgency, stated "
        "requirements, budget, contact details shared, and other buying signals. Respond with "
        "ONLY a minified JSON object: {\"score\": <integer 0-100>, \"reason\": \"<exactly three "
        "short lines separated by \\n explaining the score>\"}. No prose, no code fences."
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                json={
                    "model": os.getenv("BUYING_INTENT_MODEL", "gpt-4.1-mini"),
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": sys},
                        {"role": "user", "content": f"Summary:\n{summary or '(none)'}\n\nTranscript:\n{convo}"},
                    ],
                },
            )
        raw = r.json()["choices"][0]["message"]["content"]
        i, j = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[i : j + 1]) if (i != -1 and j != -1) else {}
        score = max(0, min(100, int(data.get("score"))))
        reason = str(data.get("reason") or "").strip()
        return score, reason
    except Exception:
        return None, ""


async def _score_buying_intent_bg(contact_id: uuid.UUID) -> None:
    """Compute + persist the buying-intent score for one completed call (own DB session)."""
    try:
        async with AsyncSessionLocal() as db:
            c = await db.get(CampaignContact, contact_id)
            if not c or not c.transcript:
                return
            score, reason = await _buying_intent(c.transcript, c.summary or "")
            if score is None:
                return
            c.buying_intent_score = score
            c.buying_intent_reason = reason
            await db.commit()
    except Exception:
        pass  # best-effort; never disrupt the campaign


@app.post("/campaign/report")
async def campaign_report(req: ReportRequest, db: AsyncSession = Depends(get_db)):
    contact = await db.get(CampaignContact, uuid.UUID(req.campaign_contact_id))
    if not contact:
        raise HTTPException(status_code=404, detail="Campaign contact not found")
    # All routing + slot release live in the shared finalizer (also used by /hangup + watchdog).
    await _finalize_contact(
        db, contact,
        status=req.status, outcome=req.outcome, summary=req.summary,
        collected=req.collected, callback_in_days=req.callback_in_days,
        callback_note=req.callback_note,
    )
    return {"ok": True}


def _contact_row_db(c: CampaignContact) -> dict:
    return {
        "campaign_contact_id": str(c.id),
        "sno": c.sno,
        "name": c.name,
        "phone": c.phone,
        "status": c.status.value,
        "current_stage": c.current_stage or "",
        "final_outcome": c.final_outcome or "",
        "has_summary": bool(c.summary),
        "has_transcript": bool(c.transcript),
        "collected": c.collected or {},
        "has_recording": bool(c.recording_url),
    }


async def _load_contacts(db: AsyncSession, campaign_id: uuid.UUID) -> list[CampaignContact]:
    result = await db.execute(
        select(CampaignContact)
        .where(CampaignContact.campaign_id == campaign_id)
        .order_by(CampaignContact.sno)
    )
    return list(result.scalars().all())


@app.get("/campaign/state")
async def campaign_state(campaign_id: str | None = None, db: AsyncSession = Depends(get_db)):
    """Everything the dashboard polls: contacts, progress, and the active call's transcript."""
    if campaign_id:
        try:
            cid = uuid.UUID(campaign_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid campaign id")
    else:
        cid = campaign_engine.running_campaign_id

    if cid is None:
        return {
            "running": False, "paused": False, "status": "", "campaign_name": "", "workflow": "",
            "active_campaign_contact_id": None, "active_name": None,
            "active_status": None, "active_stage": None, "active_transcript": [],
            "progress": {"total": 0, "completed": 0, "failed": 0,
                         "no_answer": 0, "remaining": 0, "calling": 0},
            "contacts": [],
        }

    camp = await db.get(Campaign, cid)
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")

    contacts = await _load_contacts(db, cid)
    total = len(contacts)
    completed = sum(1 for c in contacts if c.done and c.status == ContactStatus.FINISHED)
    failed = sum(1 for c in contacts if c.status == ContactStatus.FAILED)
    no_answer = sum(1 for c in contacts if c.status == ContactStatus.NO_ANSWER)
    calling = sum(1 for c in contacts if c.status in (ContactStatus.CALLING, ContactStatus.ANSWERED))
    remaining = sum(1 for c in contacts if not c.done)

    active_id = campaign_engine.active_contact_id
    active = next((c for c in contacts if c.id == active_id), None) if active_id else None

    return {
        "running": camp.status == CampaignStatus.RUNNING,
        "paused": camp.status == CampaignStatus.PAUSED,
        "status": camp.status.value,
        "campaign_name": camp.name,
        "workflow": camp.workflow_name,
        "active_campaign_contact_id": str(active.id) if active else None,
        "active_name": active.name if active else None,
        "active_status": active.status.value if active else None,
        "active_stage": active.current_stage if active else None,
        "active_transcript": (active.transcript or []) if active else [],
        "progress": {
            "total": total, "completed": completed, "failed": failed,
            "no_answer": no_answer, "remaining": remaining, "calling": calling,
        },
        "contacts": [_contact_row_db(c) for c in contacts],
    }


@app.get("/campaign/contact/{campaign_contact_id}")
async def campaign_contact(campaign_contact_id: str, db: AsyncSession = Depends(get_db)):
    """Full record for one contact (modals: transcript / summary / collected)."""
    try:
        ccid = uuid.UUID(campaign_contact_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid contact id")
    c = await db.get(CampaignContact, ccid)
    if not c:
        raise HTTPException(status_code=404, detail="No such contact")
    return {
        "campaign_contact_id": str(c.id),
        "sno": c.sno, "name": c.name, "phone": c.phone, "status": c.status.value,
        "current_stage": c.current_stage or "", "final_outcome": c.final_outcome or "",
        "last_outcome": c.last_outcome or "", "callback_note": c.callback_note or "",
        "summary": c.summary or "", "transcript": c.transcript or [],
        "collected": c.collected or {},
        "buying_intent_score": c.buying_intent_score,
        "buying_intent_reason": c.buying_intent_reason or "",
        "recording_url": c.recording_url or "",
    }


@app.post("/campaign/reset")
async def campaign_reset(campaign_id: str | None = None, db: AsyncSession = Depends(get_db)):
    """Stop the engine and clear per-call state for a campaign (back to CREATED)."""
    campaign_engine.reset()
    if campaign_id:
        try:
            cid = uuid.UUID(campaign_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid campaign id")
        camp = await db.get(Campaign, cid)
        if camp:
            camp.status = CampaignStatus.CREATED
            for c in await _load_contacts(db, cid):
                c.status = ContactStatus.NOT_INITIATED
                c.current_agent = c.current_stage = ""
                c.last_outcome = c.final_outcome = ""
                c.summary = c.callback_note = ""
                c.transcript = []
                c.collected = {}
                c.stages_history = []
                c.attempts = 0
                c.done = False
            await db.commit()
    return {"ok": True}


@app.post("/campaign/recording")
async def campaign_recording(req: RecordingRequest, db: AsyncSession = Depends(get_db)):
    contact = await db.get(CampaignContact, uuid.UUID(req.campaign_contact_id))
    if not contact:
        raise HTTPException(status_code=404, detail="Campaign contact not found")
    contact.recording_url = req.recording_url
    contact.recording_egress_id = req.egress_id
    await db.commit()
    return {"ok": True}


# --- Human transfer leads + analytics ---
@app.get("/human-transfers")
async def get_human_transfers(campaign_id: str | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(HumanTransfer).order_by(HumanTransfer.created_at.desc())
    if campaign_id:
        try:
            stmt = stmt.where(HumanTransfer.campaign_id == uuid.UUID(campaign_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid campaign id")
    result = await db.execute(stmt)
    transfers = result.scalars().all()
    return {
        "transfers": [
            {
                "id": str(t.id), "name": t.name, "phone": t.phone,
                "workflow_name": t.workflow_name, "final_outcome": t.final_outcome,
                "collected": t.collected or {}, "summary": t.summary or "",
                "campaign_id": str(t.campaign_id) if t.campaign_id else None,
            }
            for t in transfers
        ]
    }


@app.get("/analytics")
async def get_analytics(campaign_id: str | None = None, db: AsyncSession = Depends(get_db)):
    # Scope to one campaign when an id is given; otherwise aggregate across ALL campaigns.
    cid = uuid.UUID(campaign_id) if campaign_id else None

    if cid is not None:
        contacts = await _load_contacts(db, cid)
    else:
        result = await db.execute(select(CampaignContact))
        contacts = list(result.scalars().all())

    total = len(contacts)
    attempted = sum(1 for c in contacts if c.attempts > 0)
    answered = sum(1 for c in contacts if c.status in (ContactStatus.ANSWERED, ContactStatus.FINISHED))
    no_answer = sum(1 for c in contacts if c.status == ContactStatus.NO_ANSWER)
    failed = sum(1 for c in contacts if c.status == ContactStatus.FAILED)
    qualified = sum(1 for c in contacts if (c.final_outcome or "").upper()
                    in ("QUALIFIED", "INTERESTED", "APPOINTMENT_BOOKED"))

    ht_stmt = select(HumanTransfer)
    if cid is not None:
        ht_stmt = ht_stmt.where(HumanTransfer.campaign_id == cid)
    transfers = len((await db.execute(ht_stmt)).scalars().all())

    conv = round(100.0 * qualified / total, 1) if total else 0.0

    return {
        "total_contacts": total, "calls_attempted": attempted, "calls_answered": answered,
        "no_answer": no_answer, "failed": failed, "qualified_leads": qualified,
        "human_transfers": transfers, "conversion_rate": conv,
    }

# ===========================================================================
# Static frontend — serve the built React app (web/dist). Falls back to the
# legacy index.html until the React app is built. Declared LAST so it never
# shadows the API routes above.
# ===========================================================================
WEB_DIST = Path(__file__).parent / "web" / "dist"
LEGACY_INDEX = Path(__file__).parent / "index.html"


def _serve_index() -> HTMLResponse:
    idx = WEB_DIST / "index.html"
    if idx.exists():
        return HTMLResponse(idx.read_text(encoding="utf-8"))
    if LEGACY_INDEX.exists():
        return HTMLResponse(LEGACY_INDEX.read_text(encoding="utf-8"))
    return HTMLResponse(
        "<h1>Frontend not built</h1><p>Run <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code>.</p>",
        status_code=200,
    )


@app.get("/", response_class=HTMLResponse)
async def serve_root():
    return _serve_index()


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve built static assets, and fall back to index.html for client-side routes.
    (GET-only catch-all; declared after every API route so it can't shadow them.)"""
    if WEB_DIST.exists():
        candidate = (WEB_DIST / full_path).resolve()
        if WEB_DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
    return _serve_index()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
