import { useCallback, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type Participant,
} from "livekit-client";
import { api } from "@/services/api";
import type { CallMode, TranscriptLine } from "@/types";

export interface CallMetrics {
  tokIn: number;
  tokOut: number;
  llmCalls: number;
  tps: string;
  ttft: string;
  ttfa: string;
  ttfb: string;
  eou: string;
  sttAudio: number;
  ttsChars: number;
  ttsAudio: number;
}

const EMPTY_METRICS: CallMetrics = {
  tokIn: 0, tokOut: 0, llmCalls: 0, tps: "—", ttft: "—", ttfa: "—", ttfb: "—", eou: "—",
  sttAudio: 0, ttsChars: 0, ttsAudio: 0,
};

export type CallPhase = "idle" | "connecting" | "active" | "ended";

export interface CallState {
  phase: CallPhase;
  mode: CallMode;
  statusLabel: string;
  orbState: "" | "speaking" | "listening";
  transcript: TranscriptLine[];
  metrics: CallMetrics;
  durationSec: number;
  summary: string | null;
  collected: Record<string, string>;
  room: string;
  error: string | null;
}

function fmtMs(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const ms = sec * 1000;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${sec.toFixed(2)} s`;
}

function roleFor(p: Participant | undefined, localId: string | undefined): "user" | "agent" {
  if (!p) return "agent";
  if (localId && p.identity === localId) return "user";
  if (p.identity.startsWith("sip_")) return "user";
  return "agent";
}

export function useLiveKitCall() {
  const [state, setState] = useState<CallState>({
    phase: "idle", mode: "browser", statusLabel: "Idle", orbState: "", transcript: [],
    metrics: EMPTY_METRICS, durationSec: 0, summary: null, collected: {}, room: "—", error: null,
  });

  const roomRef = useRef<Room | null>(null);
  const audioEls = useRef<HTMLMediaElement[]>([]);
  const attachedAudioTracks = useRef<Set<string>>(new Set());
  const durationTimer = useRef<number | null>(null);
  const connectedAt = useRef(0);
  const summaryResolve = useRef<(() => void) | null>(null);
  const ttfa = useRef({ sum: 0, count: 0, max: 0 });
  const modeRef = useRef<CallMode>("browser");

  const patch = useCallback((p: Partial<CallState>) => setState((s) => ({ ...s, ...p })), []);

  const stopTimer = () => {
    if (durationTimer.current) window.clearInterval(durationTimer.current);
    durationTimer.current = null;
  };

  const attachAudioTrack = useCallback((track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;

    const key = track.sid || `${track.mediaStreamTrack.id}-${audioEls.current.length}`;
    if (attachedAudioTracks.current.has(key)) return;
    attachedAudioTracks.current.add(key);

    const el = track.attach();
    el.autoplay = true;
    el.setAttribute("playsinline", "true");
    el.style.display = "none";
    document.body.appendChild(el);
    audioEls.current.push(el);

    const playResult = el.play();
    if (playResult) {
      playResult.catch(() => {
        patch({
          error: "Audio playback was blocked by the browser. Click Hang up, then start the call again.",
        });
      });
    }
  }, [patch]);

  const attachExistingRemoteAudio = useCallback((room: Room) => {
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        const track = publication.track;
        if (track && publication.isSubscribed && track.kind === Track.Kind.Audio) {
          attachAudioTrack(track);
        }
      });
    });
  }, [attachAudioTrack]);

  const handleData = useCallback((payload: Uint8Array) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const type = data.type as string;
    if (type === "metric") {
      const m = (data.data ?? {}) as Record<string, number>;
      const kind = data.metric_type as string;
      setState((s) => {
        const x = { ...s.metrics };
        if (kind === "llm") {
          if (m.prompt_tokens != null) x.tokIn += m.prompt_tokens;
          if (m.completion_tokens != null) x.tokOut += m.completion_tokens;
          x.llmCalls += 1;
          if (m.tokens_per_second != null) x.tps = m.tokens_per_second.toFixed(1);
          if (m.ttft != null) x.ttft = fmtMs(m.ttft);
        } else if (kind === "ttfa" && m.ttfa != null) {
          x.ttfa = fmtMs(m.ttfa);
        } else if (kind === "tts") {
          if (m.ttfb != null) x.ttfb = fmtMs(m.ttfb);
          if (m.characters_count != null) x.ttsChars += m.characters_count;
          if (m.audio_duration != null) x.ttsAudio += m.audio_duration;
        } else if (kind === "stt") {
          if (m.audio_duration != null) x.sttAudio += m.audio_duration;
        } else if (kind === "eou" && m.end_of_utterance_delay != null) {
          x.eou = fmtMs(m.end_of_utterance_delay);
        }
        return { ...s, metrics: x };
      });
    } else if (type === "call_status") {
      const status = data.status as string;
      if (status === "active") patch({ statusLabel: modeRef.current === "phone" ? "On call" : "Connected" });
      else if (status === "dialing") patch({ statusLabel: "Ringing…" });
      else if (status === "failed") patch({ statusLabel: "Call failed", error: String(data.detail ?? "Call failed") });
      else if (status === "ended") void endCall(false);
    } else if (type === "summary") {
      patch({ summary: (data.text as string) || "(no summary)" });
      summaryResolve.current?.();
      summaryResolve.current = null;
    } else if (type === "collected") {
      patch({ collected: (data.data ?? {}) as Record<string, string> });
    }
  }, [patch]);

  const wireRoom = useCallback((room: Room) => {
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const localId = room.localParticipant.identity;
      const remoteSpeaking = speakers.some((s) => s.identity !== localId);
      const meSpeaking = speakers.some((s) => s.identity === localId);
      if (modeRef.current === "phone") patch({ orbState: remoteSpeaking ? "speaking" : "" });
      else if (remoteSpeaking) patch({ orbState: "speaking" });
      else if (meSpeaking) patch({ orbState: "listening" });
      else patch({ orbState: "" });
    });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
      attachAudioTrack(track);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.sid) attachedAudioTracks.current.delete(track.sid);
      track.detach().forEach((el) => el.remove());
    });
    room.on(RoomEvent.DataReceived, (payload) => handleData(payload));
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      const localId = room.localParticipant.identity;
      const role = roleFor(participant, localId);
      const finals = segments.filter((s) => s.final);
      if (finals.length) {
        setState((s) => ({ ...s, transcript: [...s.transcript, ...finals.map((seg) => ({ role, text: seg.text }))] }));
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      stopTimer();
    });
  }, [handleData, patch]);

  const start = useCallback(async (mode: CallMode, agent: string, phone?: string) => {
    modeRef.current = mode;
    ttfa.current = { sum: 0, count: 0, max: 0 };
    patch({
      phase: "connecting", mode, error: null, summary: null, collected: {}, transcript: [], metrics: EMPTY_METRICS,
      statusLabel: mode === "phone" ? "Calling…" : "Connecting…", orbState: "",
    });
    try {
      const session = mode === "phone" ? await api.callPhone(phone ?? "", agent) : await api.connectBrowser(agent);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      wireRoom(room);
      await room.connect(session.url, session.token);
      attachExistingRemoteAudio(room);
      if (mode === "browser") await room.localParticipant.setMicrophoneEnabled(true);

      connectedAt.current = Date.now();
      stopTimer();
      durationTimer.current = window.setInterval(() => {
        patch({ durationSec: Math.floor((Date.now() - connectedAt.current) / 1000) });
      }, 1000);

      patch({
        phase: "active",
        room: session.room,
        statusLabel: mode === "phone" ? `Calling ${session.phone ?? phone ?? ""}…` : "Connected",
      });
    } catch (e) {
      patch({ phase: "idle", error: e instanceof Error ? e.message : String(e), statusLabel: "Idle" });
      if (roomRef.current) {
        void roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  }, [patch, wireRoom]);

  const endCall = useCallback(async (requestRecap: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    stopTimer();
    patch({ phase: "ended", statusLabel: "Call ended", orbState: "", summary: state.summary ?? "" });
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      /* observer can't publish — ignore */
    }
    if (requestRecap) {
      try {
        await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "end_call" })), {
          reliable: true,
          topic: "control",
        });
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      summaryResolve.current = resolve;
      window.setTimeout(() => {
        summaryResolve.current = null;
        resolve();
      }, 12000);
    });
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, state.summary]);

  const reset = useCallback(() => {
    audioEls.current.forEach((el) => el.remove());
    audioEls.current = [];
    attachedAudioTracks.current.clear();
    stopTimer();
    setState({
      phase: "idle", mode: "browser", statusLabel: "Idle", orbState: "", transcript: [],
      metrics: EMPTY_METRICS, durationSec: 0, summary: null, collected: {}, room: "—", error: null,
    });
  }, []);

  return { state, start, endCall, reset };
}
