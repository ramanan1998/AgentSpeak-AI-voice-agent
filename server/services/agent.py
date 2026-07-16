"""
agent.py — Pipecat voice agent. The Pipecat replacement for the old LiveKit agent.py.

One run_bot() drives BOTH transports:
  • phone   : FastAPIWebsocketTransport over the Vobiz media stream (µ-law 8k)
  • browser : SmallWebRTCTransport (mic in the browser)

Like the old agent, this bot is DECOUPLED from the database: it reports back to the
FastAPI control plane over HTTP — /campaign/status, /campaign/transcript, /campaign/report —
using the `campaign` block in the metadata envelope that server.py's _pump() builds.

Idle detection (1.4.0): handled INSIDE the user aggregator via
LLMUserAggregatorParams(user_idle_timeout=...). We escalate over the on_user_turn_idle
event and end the call on the 3rd strike through the SAME EndTaskFrame path as end_call,
so _finalize_call() still files the report. The counter resets on on_user_turn_started.
"""

import json
import os
import time

import httpx
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.workers.runner import WorkerRunner
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    Frame,
    LLMRunFrame,
    LLMTextFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    EndTaskFrame,
    LLMMessagesAppendFrame,
    TTSSpeakFrame,
    MetricsFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, TTSUsageMetricsData, TTFBMetricsData
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.observers.base_observer import BaseObserver, FramePushed

# Telephony turn tuning. VAD ends speech after stop_secs of silence; the stop strategy then
# waits up to user_speech_timeout for the caller to resume before ending the turn (short-
# circuited when Deepgram finalizes). Both loaded ONCE at import. Lower = snappier.
_VAD_STOP_SECS = float(os.getenv("VAD_STOP_SECS", "0.4"))
_USER_SPEECH_TIMEOUT = float(os.getenv("USER_SPEECH_TIMEOUT", "0.6"))
_SHARED_VAD = SileroVADAnalyzer(params=VADParams(stop_secs=_VAD_STOP_SECS))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EXTRACT_MODEL = os.getenv("EXTRACT_MODEL", "gpt-4.1-mini")
# Seconds of silence (after the bot stops speaking) before a check-in fires. 3 strikes ≈ 3×.
# 10s suits telephony — phone pauses run longer than browser; a too-eager prompt is annoying.
IDLE_TIMEOUT = float(os.getenv("IDLE_TIMEOUT_SECS", "10"))


# ───────────────────────────────────────────────────────────────────────────────────────
# Transcript capture — two tiny taps. _UserTranscriptTap coalesces Deepgram finals into one
# utterance per turn; _AssistantTranscriptTap buffers LLMTextFrame (already spaced) and flushes
# one utterance per spoken turn on BotStoppedSpeakingFrame.
# ───────────────────────────────────────────────────────────────────────────────────────
class _UserTranscriptTap(FrameProcessor):
    """Coalesces a caller's finalized transcription fragments into one utterance per turn."""

    def __init__(self, on_line):
        super().__init__()
        self._on_line = on_line
        self._buf: list[str] = []

    async def _flush(self):
        text = " ".join(self._buf).strip()
        self._buf = []
        if text:
            await self._on_line("user", text)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and (frame.text or "").strip():
            self._buf.append(frame.text.strip())
        elif isinstance(frame, (UserStartedSpeakingFrame, BotStoppedSpeakingFrame)):
            # caller's turn ended (they restart, or the bot takes over) → emit the utterance
            await self._flush()
        await self.push_frame(frame, direction)


class _AssistantTranscriptTap(FrameProcessor):
    """Buffers the bot's LLM text (properly spaced) and flushes one utterance per spoken turn."""

    def __init__(self, on_line):
        super().__init__()
        self._on_line = on_line
        self._buf: list[str] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMTextFrame):
            if frame.text:
                self._buf.append(frame.text)
        elif isinstance(frame, BotStoppedSpeakingFrame):
            text = "".join(self._buf).strip()   # LLMTextFrame already includes spaces
            self._buf = []
            if text:
                await self._on_line("assistant", text)
        await self.push_frame(frame, direction)

class _MetricsCollector:
    """Accumulates billable units + latency for one call."""
    def __init__(self):
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.tts_characters = 0
        self.ttfb_samples: list[float] = []

    def ingest(self, frame):
        for item in getattr(frame, "data", None) or []:
            print(f"[metrics] {type(item).__name__} value={getattr(item, 'value', None)!r}", flush=True)
            try:
                if isinstance(item, LLMUsageMetricsData):
                    tok = item.value
                    self.prompt_tokens += int(getattr(tok, "prompt_tokens", 0) or 0)
                    self.completion_tokens += int(getattr(tok, "completion_tokens", 0) or 0)
                elif isinstance(item, TTSUsageMetricsData):
                    self.tts_characters += int(item.value or 0)
                elif isinstance(item, TTFBMetricsData):
                    v = float(item.value or 0)
                    if v > 0:
                        self.ttfb_samples.append(round(v, 3))
            except Exception:
                continue

    def snapshot(self, *, duration_seconds: float, turns: int) -> dict:
        return {
            "stt_audio_seconds": round(duration_seconds, 2),
            "llm_prompt_tokens": self.prompt_tokens,
            "llm_completion_tokens": self.completion_tokens,
            "tts_characters": self.tts_characters,
            "turns": turns,
            "ttft_samples": self.ttfb_samples,
            "duration_seconds": round(duration_seconds, 2),
        }


class _MetricsObserver(BaseObserver):
    """Sees every pushed frame (incl. MetricsFrame, which never reaches inline processors in
    this build) and feeds MetricsFrames into the collector."""

    def __init__(self, collector):
        super().__init__()
        self._collector = collector

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if isinstance(frame, MetricsFrame):
            self._collector.ingest(frame)


# ───────────────────────────────────────────────────────────────────────────────────────
# System-prompt builder — re-derived from the AgentConfig fields server.py sends in `agent`,
# plus the workflow `context`, `master_fields`, and stage `focus`.
# ───────────────────────────────────────────────────────────────────────────────────────
def build_instructions(meta: dict) -> str:
    cfg = meta.get("agent") or {}
    ctx = meta.get("context") or {}
    master_fields = meta.get("master_fields") or []
    focus = meta.get("focus") or []
    name = meta.get("contact_name") or "the customer"

    tone = ", ".join(cfg.get("tone") or []) or "natural, clear"
    out = []
    out.append(f"You are {cfg.get('agent_name', 'an assistant')}, on a live phone call with {name}.")
    out.append("Your words are spoken aloud — no emojis, markdown, or lists. Keep turns short and conversational.")
    if cfg.get("instruction_prompt"):
        out.append("\n## Your role & purpose\n" + cfg["instruction_prompt"])
    if cfg.get("greeting"):
        out.append("\n## Opening\nOpen along these lines: " + cfg["greeting"])
    if cfg.get("sign_off"):
        out.append(
            "\n## Ending the call\nAfter you deliver your closing line, call the `end_call` "
            "function to hang up. Also call it if the customer asks to end the call."
            # "IMPORTANT: never write, say, or read the function name or any code aloud — the "
            # "function is invoked silently. Your spoken reply must contain only natural words "
            # "the caller should hear, never 'end_call', 'functions.end_call()', or similar."
        )
    if cfg.get("negative_instructions"):
        out.append("\n## Never do this\n" + cfg["negative_instructions"])
    out.append("\n## Tone\n" + tone)

    collect = master_fields or cfg.get("data_fields") or []
    field_names = [f.get("name", "") for f in collect if f.get("name")]
    if field_names:
        out.append("\n## Information to collect during the call\n" + ", ".join(field_names))
        if focus:
            out.append("Prioritise collecting: " + ", ".join(focus))

    collected = ctx.get("collected") or {}
    known = "; ".join(f"{k}: {v}" for k, v in collected.items() if v)
    if known:
        out.append("\n## Already known (do NOT re-ask)\n" + known)
    if ctx.get("previous_summary"):
        out.append("\n## Summary of the prior conversation\n" + ctx["previous_summary"])
    if ctx.get("callback_note"):
        out.append("\n## Callback note\n" + ctx["callback_note"])

    if cfg.get("outcomes"):
        out.append("\n## Possible call outcomes\n" + ", ".join(cfg["outcomes"]))
    return "\n".join(out)


# ───────────────────────────────────────────────────────────────────────────────────────
# Post-call extraction — produces exactly the shape POST /campaign/report expects.
# ───────────────────────────────────────────────────────────────────────────────────────
async def _extract_outcome(transcript_lines: list[dict], meta: dict, http: httpx.AsyncClient) -> dict:
    cfg = meta.get("agent") or {}
    outcomes = cfg.get("outcomes") or []
    fields = meta.get("master_fields") or cfg.get("data_fields") or []
    field_names = [f.get("name") for f in fields if f.get("name")]

    convo = "\n".join(
        f'{"Caller" if l["role"] == "user" else "Agent"}: {l["text"]}' for l in transcript_lines
    )
    if not convo.strip():
        return {"status": "No Answer", "outcome": "", "summary": "", "collected": {}}

    sys = (
        "You analyze a completed phone call and return ONLY a minified JSON object: "
        '{"status": one of ["Finished","No Answer","Failed"], '
        f'"outcome": one of {json.dumps(outcomes + [""])}, '
        '"summary": "a 2-3 sentence summary", '
        '"collected": {field: value}, '
        '"callback_in_days": number or null, "callback_note": ""}. '
        f"Collected fields to look for: {json.dumps(field_names)}. "
        "Only include a collected field if the caller actually provided it. No prose, no code fences."
    )
    try:
        r = await http.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": EXTRACT_MODEL,
                "temperature": 0,
                "messages": [{"role": "system", "content": sys}, {"role": "user", "content": convo}],
            },
            timeout=30,
        )
        raw = r.json()["choices"][0]["message"]["content"]
        i, j = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[i : j + 1])
        return {
            "status": data.get("status", "Finished"),
            "outcome": data.get("outcome", "") or "",
            "summary": data.get("summary", "") or "",
            "collected": data.get("collected") or {},
            "callback_in_days": data.get("callback_in_days"),
            "callback_note": data.get("callback_note", "") or "",
        }
    except Exception as e:
        logger.warning(f"outcome extraction failed: {e}")
        return {"status": "Finished", "outcome": "", "summary": "", "collected": {}}


# ───────────────────────────────────────────────────────────────────────────────────────
# Core bot — transport-agnostic. `mode` only changes how the opening turn is triggered.
# ───────────────────────────────────────────────────────────────────────────────────────
async def run_bot(transport, meta: dict, *, mode: str):
    camp = meta.get("campaign") or {}
    ccid = camp.get("campaign_contact_id")
    report_base = camp.get("report_url")  # e.g. "http://127.0.0.1:8000/campaign"
    ctx = meta.get("context") or {}

    http = httpx.AsyncClient(timeout=10)
    transcript_lines: list[dict] = []

    async def report(path: str, payload: dict):
        if not report_base:
            return
        try:
            await http.post(f"{report_base}/{path}", json=payload)
        except Exception as e:
            logger.warning(f"report {path} failed: {e}")

    async def on_line(role: str, text: str):
        transcript_lines.append({"role": role, "text": text})
        await report("transcript", {"campaign_contact_id": ccid, "role": role, "text": text})

    transcript_user = _UserTranscriptTap(on_line)
    transcript_assistant = _AssistantTranscriptTap(on_line)

    metrics = _MetricsCollector()
    metrics_observer = _MetricsObserver(metrics)
    _call_started = time.monotonic()
    _turn_count = {"n": 0}

    # Services — identical to your working bot.py so they match your pinned version.
    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice=os.getenv("CARTESIA_VOICE_ID", "71a7ad14-091c-4e8e-a314-022ece01c121"),
        ),
    )
    # llm = OpenAIResponsesLLMService(
    #     api_key=OPENAI_API_KEY,
    #     settings=OpenAIResponsesLLMService.Settings(
    #         model=os.getenv("OPENAI_MODEL", "gpt-4.1"),
    #         system_instruction=build_instructions(meta),
    #     ),
    # )

    llm = OpenAILLMService(
        api_key=OPENAI_API_KEY,
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
    )

    async def _end_call(params: FunctionCallParams):
        # Acknowledge the tool call, then push EndTaskFrame UPSTREAM so it flows through the
        # pipeline *behind* the closing line's audio — the call ends only after the sign-off
        # finishes playing. auto_hang_up on the Vobiz serializer then hangs up the Vobiz call.
        await params.result_callback({"status": "ending"})
        await params.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)

    end_call_fn = FunctionSchema(
        name="end_call",
        description=(
            "End the phone call. Call this only AFTER you have delivered your closing/sign-off "
            "line and the conversation is genuinely complete, or if the customer asks to hang up."
        ),
        properties={},
        required=[],
    )
    llm.register_function("end_call", _end_call)
    tools = ToolsSchema(standard_tools=[end_call_fn])

    context = LLMContext(
        messages=[{"role": "system", "content": build_instructions(meta)}],
        tools=tools,
    )
    
    # Idle detection lives on the user aggregator (1.4.0). The timer starts when the bot stops
    # speaking and is suppressed during function calls / active turns, so no false triggers.
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=_SHARED_VAD,
            user_idle_timeout=IDLE_TIMEOUT,
            # VAD-only turn detection — no Smart Turn model, no per-turn ONNX inference.
            user_turn_strategies=UserTurnStrategies(
                stop=[SpeechTimeoutUserTurnStopStrategy(
                    user_speech_timeout=_USER_SPEECH_TIMEOUT,
                )]
            ),
        ),
    )

    # ── Silent-caller handling: escalate twice, end on the 3rd strike. ──
    # dict (not a bare int) so the closures mutate shared state without `nonlocal`.
    idle_retries = {"n": 0}

    @user_aggregator.event_handler("on_user_turn_idle")
    async def _on_user_turn_idle(aggregator):
        idle_retries["n"] += 1
        n = idle_retries["n"]
        if n == 1:
            await aggregator.push_frame(LLMMessagesAppendFrame(
                [{"role": "developer",
                  "content": "The caller has gone quiet. Briefly and politely ask if they're still there."}],
                run_llm=True,
            ))
        elif n == 2:
            await aggregator.push_frame(LLMMessagesAppendFrame(
                [{"role": "developer",
                  "content": "The caller is still silent. Ask once more if they'd like to continue."}],
                run_llm=True,
            ))
        else:
            # 3rd strike → fixed goodbye, then end via the SAME upstream EndTaskFrame path as
            # end_call. runner.run() returns → _finalize_call() files the report/status.
            await aggregator.push_frame(
                TTSSpeakFrame("I haven't heard from you, so I'll let you go. Goodbye!")
            )
            await aggregator.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)

    @user_aggregator.event_handler("on_user_turn_started")
    async def _on_user_turn_started(aggregator, strategy):
        idle_retries["n"] = 0   # caller spoke → reset, so "3 strikes" means 3 *consecutive*
        _turn_count["n"] += 1

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            transcript_user,
            user_aggregator,
            llm,
            transcript_assistant,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=[metrics_observer],
    )

    async def start_conversation():
        partial = ctx.get("partial_transcript") or []
        if ctx.get("resuming") and partial:
            # Warm resume: replay the interrupted stage so the agent continues, not restarts.
            for l in partial:
                role = "user" if l.get("role") == "user" else "assistant"
                context.add_message({"role": role, "content": l.get("text", "")})
            context.add_message(
                {"role": "developer", "content": "Continue naturally from where the call left off."}
            )
        else:
            context.add_message(
                {"role": "developer", "content": "Start by greeting and introducing yourself per your instructions."}
            )
        await report("status", {"campaign_contact_id": ccid, "status": "Answered"})
        await worker.queue_frames([LLMRunFrame()])

    if mode == "phone":
        # No RTVI client on a phone call — open the conversation as soon as media connects.
        @transport.event_handler("on_client_connected")
        async def _connected(_t, _c):
            await start_conversation()
    else:
        # Browser: wait for the RTVI client handshake, like your original quickstart.
        @worker.rtvi.event_handler("on_client_ready")
        async def _ready(_r):
            await start_conversation()

    # ── Single end-of-call path. Idempotent so the disconnect handler and the post-run
    #    finalize can't double-file. Covers BOTH: caller hangs up (on_client_disconnected)
    #    and bot ends the call via EndTaskFrame (end_call OR 3rd idle strike → runner.run returns).
    _finalized = False

    async def _finalize_call():
        nonlocal _finalized
        if _finalized:
            return
        _finalized = True
        print(f"[bot] finalizing ccid={ccid}", flush=True)
        result = await _extract_outcome(transcript_lines, meta, http)
        print(f"[bot] outcome={result}", flush=True)
        await report("report", {"campaign_contact_id": ccid, **result})
        await report("status", {"campaign_contact_id": ccid,
                                "status": result.get("status", "Finished")})
        await report("metrics", {
            "campaign_contact_id": ccid,
            **metrics.snapshot(duration_seconds=time.monotonic() - _call_started,
                               turns=_turn_count["n"]),
        })

    @transport.event_handler("on_client_disconnected")
    async def _disconnected(_t, _c):
        await _finalize_call()
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    try:
        await runner.add_workers(worker)
        await runner.run()
        await _finalize_call()   # covers the end_call / idle-end (EndTaskFrame) path
    finally:
        await http.aclose()


# ───────────────────────────────────────────────────────────────────────────────────────
# Phone entry — called from server.py's /ws handler.
# ───────────────────────────────────────────────────────────────────────────────────────
async def run_phone_bot(websocket, meta: dict):
    from pipecat.serializers.vobiz import VobizFrameSerializer, parse_vobiz_start
    from pipecat.transports.websocket.fastapi import (
        FastAPIWebsocketParams,
        FastAPIWebsocketTransport,
    )

    parsed = await parse_vobiz_start(websocket)
    logger.info(
        f"Vobiz start: callId={parsed['call_id']!r}, streamId={parsed['stream_id']!r}, "
        f"mediaFormat=({parsed['encoding']!r}, {parsed['sample_rate']})"
    )

    serializer = VobizFrameSerializer(
        stream_id=parsed["stream_id"],
        call_id=parsed["call_id"],
        auth_id=os.getenv("VOBIZ_AUTH_ID", ""),
        auth_token=os.getenv("VOBIZ_AUTH_TOKEN", ""),
        params=VobizFrameSerializer.InputParams(
            vobiz_sample_rate=parsed["sample_rate"] or 8000,
            encoding=parsed["encoding"] or "audio/x-mulaw",
            sample_rate=None,
            l16_byte_order=os.getenv("VOBIZ_L16_ENDIAN", "be"),
            auto_hang_up=True,
        ),
    )
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,   # CRITICAL for telephony
            serializer=serializer,
        ),
    )
    await run_bot(transport, meta, mode="phone")


# ───────────────────────────────────────────────────────────────────────────────────────
# Browser entry — called from server.py's /connect handler with the SDP offer.
# ───────────────────────────────────────────────────────────────────────────────────────
async def run_browser_bot(connection, meta: dict):
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    await run_bot(transport, meta, mode="browser")