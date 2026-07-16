import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PhoneOutgoing, Mic, PhoneOff, RotateCcw, UserRound, PhoneCall, CheckCircle2, Lightbulb, Info, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  PipecatClientProvider,
  PipecatClientAudio,
  usePipecatClient,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { api } from "@/services/api";
import type { Agent, CallMode, TranscriptLine } from "@/types";
import { Transcript } from "@/components/Transcript";
import { fmtDuration } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Same-origin in prod (server serves the SPA); set VITE_API_URL in dev if the API is elsewhere.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type Phase = "idle" | "connecting" | "active" | "ended";
type Orb = "" | "speaking" | "listening";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-secondary/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function InfoBox({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-secondary/40 p-3 text-xs text-muted-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Step({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

// ── Root: owns the singleton PipecatClient + provider + audio sink ──────────────
export default function CallPage() {
  const client = useMemo(
    () =>
      new PipecatClient({
        transport: new SmallWebRTCTransport({
          iceServers: [
            {
              urls: "turn:45.195.159.250:3478?transport=udp",
              username: "agentspeak",
              credential: "agentspeak",
            },
          ],
        }),
        enableMic: true,
        enableCam: false,
      }),
    [],
  );

  // Tear the peer connection down if the page unmounts mid-call.
  useEffect(() => {
    return () => {
      void client.disconnect().catch(() => {});
    };
  }, [client]);

  return (
    <PipecatClientProvider client={client as never}>
      <PipecatClientAudio />
      <CallInner />
    </PipecatClientProvider>
  );
}

// ── Inner: all call logic + UI (must live inside the provider to use the hooks) ──
function CallInner() {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState("");
  const [phone, setPhone] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<CallMode>("browser");
  const [orb, setOrb] = useState<Orb>("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ttfb, setTtfb] = useState("—");

  // End-of-call recap (phone): summary + collected pulled from the test session.
  const [summary, setSummary] = useState("");
  const [collected, setCollected] = useState<Record<string, string>>({});

  const durationTimer = useRef<number | null>(null);
  const connectedAt = useRef(0);
  // The test_session_id returned by POST /call — the key we poll on for phone calls.
  const ccidRef = useRef<string>("");

  useEffect(() => {
    api.listAgents().then((r) => setAgents(r.agents)).catch(() => setAgents([]));
  }, []);

  const appendLine = useCallback((role: "user" | "agent", text: string) => {
    const t = text.trim();
    if (t) setTranscript((prev) => [...prev, { role, text: t }]);
  }, []);

  // ── Browser transcript — final caller lines + bot utterances over RTVI. ──
  // (Phone uses polling below; these RTVI events never fire for phone calls.)
  useRTVIClientEvent(
    RTVIEvent.UserTranscript as any,
    useCallback((d: { text?: string; final?: boolean }) => {
      if (d?.final && d.text) appendLine("user", d.text);
    }, [appendLine]),
  );
  useRTVIClientEvent(
    RTVIEvent.BotTranscript as any,
    useCallback((d: string | { text?: string }) => {
      appendLine("agent", typeof d === "string" ? d : d?.text ?? "");
    }, [appendLine]),
  );

  // Orb / talking indicator (browser only).
  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking as any, useCallback(() => setOrb("speaking"), []));
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking as any, useCallback(() => setOrb(""), []));
  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking as any, useCallback(() => setOrb("listening"), []));
  useRTVIClientEvent(RTVIEvent.UserStoppedSpeaking as any, useCallback(() => setOrb(""), []));

  useRTVIClientEvent(
    RTVIEvent.Metrics as any,
    useCallback((data: { ttfb?: Array<{ value?: number }> }) => {
      const v = data?.ttfb?.[0]?.value;
      if (typeof v === "number") setTtfb(v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
    }, []),
  );

  // Browser bot left / connection dropped → call ended.
  useRTVIClientEvent(
    RTVIEvent.Disconnected as any,
    useCallback(() => {
      setPhase((p) => (p === "active" || p === "connecting" ? "ended" : p));
      setOrb("");
    }, []),
  );

  const stopTimer = () => {
    if (durationTimer.current) window.clearInterval(durationTimer.current);
    durationTimer.current = null;
  };
  useEffect(() => stopTimer, []);

  const startTimer = () => {
    connectedAt.current = Date.now();
    stopTimer();
    durationTimer.current = window.setInterval(() => {
      setDurationSec(Math.floor((Date.now() - connectedAt.current) / 1000));
    }, 1000);
  };

  const resetState = () => {
    setOrb("");
    setTranscript([]);
    setDurationSec(0);
    setError(null);
    setTtfb("—");
    setSummary("");
    setCollected({});
  };

  // ── Phone live transcript — poll the test session while the call is active. ──
  // The bot reports every line to /test/transcript keyed by the test_session_id (= ccid);
  // we read it back here. When status flips to finished/failed we end the call and show
  // the recap (summary + collected). The server is the source of truth, so we replace the
  // whole transcript array each poll (idempotent, no dupes).
  useEffect(() => {
    if (mode !== "phone" || phase !== "active" || !ccidRef.current) return;
    let alive = true;
    const id = window.setInterval(async () => {
      try {
        const s = await api.testSession(ccidRef.current);
        if (!alive) return;
        if (Array.isArray(s.transcript)) {
          setTranscript(
            s.transcript.map((l: { role: string; text: string }) => ({
              role: l.role === "user" ? "user" : "agent",
              text: l.text,
            })),
          );
        }
        if (s.status === "finished" || s.status === "failed") {
          setSummary(s.summary || "");
          setCollected((s as { collected?: Record<string, string> }).collected || {});
          stopTimer();
          setPhase("ended");
        }
      } catch {
        /* ignore a missed poll */
      }
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);

  const startBrowser = async () => {
    setMode("browser");
    setPhase("connecting");
    resetState();
    try {
      await client.connect({ webrtcUrl: `${API_BASE}/connect?agent=${encodeURIComponent(agent)}` });
      startTimer();
      setPhase("active");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
      void client.disconnect().catch(() => {});
    }
  };

  const startPhone = async () => {
    setMode("phone");
    setPhase("connecting");
    resetState();
    try {
      // POST /call returns { mode, phone, ccid, test_session_id }. ccid === test_session_id.
      const res = await api.callPhone(phone, agent);
      ccidRef.current = res.ccid || res.test_session_id || "";
      startTimer();
      setPhase("active");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onBrowser = () => {
    if (!agent) return toast.warning("Select an agent first.");
    void startBrowser();
  };
  const onPhone = () => {
    if (!agent) return toast.warning("Select an agent first.");
    if (!/^\+\d{6,15}$/.test(phone.replace(/[\s-]/g, ""))) return toast.warning("Enter a valid number, e.g. +917708139259");
    setPhone((p) => p.replace(/[\s-]/g, ""));
    void startPhone();
  };

  const hangUp = async () => {
    stopTimer();
    setPhase("ended");
    setOrb("");
    if (mode === "browser") {
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
    // Phone calls are controlled by Vobiz/the bot; there's no in-browser channel to end them.
    // The poll will still catch the final transcript + recap on its next tick.
  };

  const reset = () => {
    stopTimer();
    resetState();
    ccidRef.current = "";
    setPhase("idle");
  };

  const statusLabel =
    phase === "idle"
      ? "Idle"
      : phase === "ended"
        ? "Call ended"
        : phase === "connecting"
          ? mode === "phone" ? "Calling…" : "Connecting…"
          : mode === "phone" ? `Calling ${phone}…` : "Connected";

  if (phase === "idle") {
    const agentSelect = (
      <div className="space-y-1.5">
        <Label>Agent</Label>
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.workflow_name} value={a.workflow_name}>
                {a.workflow_name} ({a.agent_name})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {agents.length === 0 && (
          <p className="text-xs text-muted-foreground">No agents yet — create one on the Create Agent page.</p>
        )}
      </div>
    );

    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Test your agent</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose how you want to test your AI agent.<br />
            You can receive a phone call or talk directly in the browser.
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <Badge variant="secondary" className="w-fit">Option 1</Badge>
              <CardTitle className="flex items-center gap-2 pt-1 text-lg"><PhoneOutgoing className="h-5 w-5 text-primary" /> Call my phone</CardTitle>
              <p className="text-sm text-muted-foreground">Enter your phone number and receive a call from your AI agent.</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-4">
              {agentSelect}
              <div className="space-y-1.5">
                <Label>Your phone number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+917708139259" inputMode="tel" />
              </div>
              <Button className="w-full" onClick={onPhone}><PhoneOutgoing className="h-4 w-4" /> Call my phone</Button>
              <InfoBox icon={Info}>You will receive a call from the system. Please make sure your phone is available.</InfoBox>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border bg-card text-xs font-semibold text-muted-foreground shadow-sm">OR</span>
          </div>

          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <Badge variant="secondary" className="w-fit">Option 2</Badge>
              <CardTitle className="flex items-center gap-2 pt-1 text-lg"><Mic className="h-5 w-5 text-primary" /> Talk in the browser</CardTitle>
              <p className="text-sm text-muted-foreground">Start a live conversation using your browser microphone.</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-4">
              {agentSelect}
              <Button variant="outline" className="w-full" onClick={onBrowser}><Mic className="h-4 w-4" /> Talk in the browser</Button>
              <InfoBox icon={Info}>Allow microphone permissions when prompted.</InfoBox>
            </CardContent>
          </Card>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-4">
          <h3 className="text-base font-semibold">How it works</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Step icon={UserRound} title="Select a test option" desc="Choose whether to receive a phone call or talk in the browser." />
            <Step icon={PhoneCall} title="Interact with your agent" desc="Speak naturally and verify how your AI agent responds." />
            <Step icon={CheckCircle2} title="Verify and refine" desc="Review the conversation and improve your agent if needed." />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Tip:</span> Test different scenarios to ensure your AI agent behaves correctly in real-world conversations.
          </p>
        </div>
      </div>
    );
  }

  const collectedEntries = Object.entries(collected);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {phase === "ended" && (
        <Card className="lg:col-span-2 border-l-4 border-l-primary">
          <CardHeader><CardTitle>Call ended</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">AI recap</div>
              <p className="text-sm leading-relaxed">
                {summary || (
                  <span className="text-muted-foreground">
                    {mode === "phone" ? "Generating summary…" : "Summaries are generated for phone test calls."}
                  </span>
                )}
              </p>
            </div>

            {mode === "phone" && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Collected data</div>
                {collectedEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{summary ? "No data collected." : "Extracting…"}</p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {collectedEntries.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[120px_1fr] gap-3 rounded-md border bg-secondary/40 p-2.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</span>
                        <span className="break-words font-mono text-sm">
                          {v || <span className="italic text-muted-foreground">not provided</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button onClick={reset}><RotateCcw className="h-4 w-4" /> Start new call</Button>
          </CardContent>
        </Card>
      )}

      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Live transcript</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={orb === "speaking" ? "default" : "muted"}>{statusLabel}</Badge>
            {phase === "active" && (
              <Button size="sm" variant="destructive" onClick={() => void hangUp()}>
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="h-[420px]">
          <Transcript
            lines={transcript}
            emptyText={mode === "phone" ? "Waiting for the call to connect…" : "Conversation will appear here."}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Metrics</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Status" value={statusLabel} />
            <Stat label="Duration" value={fmtDuration(durationSec)} />
            <Stat label="Transport" value={mode === "phone" ? "phone" : transportState} />
            <Stat label="TTS TTFB" value={ttfb} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}