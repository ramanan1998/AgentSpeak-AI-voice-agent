import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Phone, Mic, FileAudio, DollarSign, Clock, Zap } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { TestSessionDetail } from "@/types";
import { Transcript } from "@/components/Transcript";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";


type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

function statusBadge(status: string): { label: string; variant: BadgeVariant } {
  if (status === "finished") return { label: "Finished", variant: "success" };
  if (status === "failed") return { label: "Failed", variant: "destructive" };
  return { label: "Active", variant: "warning" };
}

const usd = (n: number) =>
  n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;   // small costs keep precision
const secs = (n: number) => `${n.toFixed(1)}s`;

export default function TestSessionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [s, setS] = useState<TestSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .testSession(id)
      .then(setS)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!s) return <div className="text-sm text-muted-foreground">Test session not found.</div>;

  const st = statusBadge(s.status);
  const created = s.created_at ? new Date(s.created_at).toLocaleString() : "—";
  const m = s.metrics;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/call-history")}>
          <ArrowLeft className="h-4 w-4" /> Back to history
        </Button>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      {/* header / meta */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {s.mode === "phone" ? <Phone className="h-5 w-5 text-primary" /> : <Mic className="h-5 w-5 text-primary" />}
            {s.mode === "phone" ? "Phone test" : "Browser test"} · {s.agent_name || s.agent_workflow}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Agent" value={s.agent_workflow} />
            <Meta label="Agent name" value={s.agent_name || "—"} />
            <Meta label="Phone" value={s.phone || "—"} mono />
            <Meta label="Tested" value={created} />
          </div>
        </CardContent>
      </Card>

      {/* cost & usage — only when the backend returned a metrics block */}
      {m && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" /> Cost & usage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* headline: total cost + call shape */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-primary/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total cost</div>
                <div className="font-mono text-lg font-semibold">{usd(m.total_cost)}</div>
              </div>
              <div className="rounded-md border bg-secondary/40 p-3">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3 w-3" /> Duration · turns
                </div>
                <div className="font-mono text-sm">{secs(m.duration_seconds)} · {m.turns} turns</div>
              </div>
              <div className="rounded-md border bg-secondary/40 p-3">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Zap className="h-3 w-3" /> Latency avg · peak
                </div>
                <div className="font-mono text-sm">{secs(m.avg_latency)} · {secs(m.peak_latency)}</div>
              </div>
            </div>

            {/* per-service breakdown */}
            <div className="grid gap-2 sm:grid-cols-3">
              <ServiceCost
                label="STT"
                cost={m.stt.cost}
                detail={`${secs(m.stt.seconds)}${m.stt.estimated ? " (est.)" : ""}`}
              />
              <ServiceCost
                label="LLM"
                cost={m.llm.cost}
                detail={`${m.llm.total_tokens.toLocaleString()} tokens`}
              />
              <ServiceCost
                label="TTS"
                cost={m.tts.cost}
                detail={`${m.tts.characters.toLocaleString()} chars`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* recording */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileAudio className="h-4 w-4" /> Recording</CardTitle></CardHeader>
        <CardContent>
          {s.recording_url ? (
            <audio controls preload="metadata" src={s.recording_url} className="w-full">
              Your browser does not support the audio element.
            </audio>
          ) : (
            <p className="text-sm text-muted-foreground">No recording available for this session.</p>
          )}
        </CardContent>
      </Card>

      {/* summary */}
      <Card>
        <CardHeader><CardTitle className="text-base">AI recap</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">
            {s.summary || <span className="text-muted-foreground">No summary.</span>}
          </p>
        </CardContent>
      </Card>

      {/* transcript */}
      <Card>
        <CardHeader><CardTitle className="text-base">Transcript</CardTitle></CardHeader>
        <CardContent className="h-[420px]">
          <Transcript lines={s.transcript} emptyText="No transcript recorded." />
        </CardContent>
      </Card>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border bg-secondary/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
    </div>
  );
}

function ServiceCost({ label, cost, detail }: { label: string; cost: number; detail: string }) {
  return (
    <div className="rounded-md border bg-secondary/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-semibold">{cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}