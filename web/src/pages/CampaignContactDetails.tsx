import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Gauge, Headphones } from "lucide-react";
import { api } from "@/services/api";
import type { TranscriptLine } from "@/types";
import { usePolling } from "@/hooks/usePolling";
import { statusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Transcript } from "@/components/Transcript";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function CampaignContactDetailsPage() {
  const navigate = useNavigate();
  const { id, contactId } = useParams<{ id: string; contactId: string }>();
  const { data: detail } = usePolling(
    () => api.campaignContact(contactId ?? ""),
    2000,
    !!contactId,
  );

  const back = () => navigate(`/campaigns/${id}`);
  const collected = detail?.collected ?? {};
  const collectedKeys = Object.keys(collected);
  const finished = detail?.status === "Finished";

  // Split the transcript into per-agent/stage groups (in execution order) for the tabs.
  const stages = useMemo(() => buildStages(detail?.transcript ?? []), [detail?.transcript]);
  const [activeStage, setActiveStage] = useState(0);
  const activeIdx = Math.min(activeStage, Math.max(0, stages.length - 1));

  return (
    <div className="space-y-6">
      {/* ---- slim top bar: back ---- */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={back}><ArrowLeft className="h-4 w-4" /></Button>
        <h2 className="text-lg font-semibold">Call Details</h2>
      </div>

      {!detail ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">Loading details…</CardContent>
        </Card>
      ) : (
        <>
        {/* ---- 1. Full-width Call Metrics card ---- */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-lg font-semibold leading-tight">{detail.name || "Contact"}</div>
                  <div className="font-mono text-sm text-muted-foreground">{detail.phone || "—"}</div>
                </div>
                <Badge variant={statusVariant(detail.status)}>{detail.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                <Meta label="Current Stage" value={detail.current_stage || "—"} />
                <Meta label="Final Outcome" value={detail.final_outcome || "—"} />
                <Meta label="Callback Note" value={detail.callback_note || "—"} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---- 1b. Call Recording (only if a recording exists or the call is finished) ---- */}
        {(detail.recording_url || finished) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-primary" /> Call Recording
              </CardTitle>
            </CardHeader>
            <CardContent>
              {detail.recording_url ? (
                <audio controls preload="none" className="w-full">
                  <source src={detail.recording_url} type="audio/ogg" />
                  Your browser does not support audio playback.
                </audio>
              ) : (
                <p className="text-sm text-muted-foreground">No recording available for this call.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- 2. Dashboard 2x2 grid (stacks on small screens) ---- */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top-left: AI Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">AI Summary</CardTitle></CardHeader>
            <CardContent>
              {detail.summary ? (
                <p className="text-sm leading-relaxed">{detail.summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No summary yet{finished ? "" : " (call not finished)"}.</p>
              )}
            </CardContent>
          </Card>

          {/* Top-right: Buying Intent Score */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4 text-primary" /> Buying Intent Score
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-center"><BuyingIntentGauge score={detail.buying_intent_score} /></div>
              <div>
                <div className="text-sm font-medium">Why this buying intent score?</div>
                {detail.buying_intent_reason ? (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {detail.buying_intent_reason}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {detail.buying_intent_score == null
                      ? (finished ? "Generating score…" : "Available after the call completes.")
                      : "No justification available."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bottom-left: Collected Data */}
          <Card>
            <CardHeader><CardTitle className="text-base">Collected Data</CardTitle></CardHeader>
            <CardContent>
              {collectedKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data collected{finished ? "" : " (call not finished)"}.</p>
              ) : (
                <div className="space-y-2">
                  {collectedKeys.map((k) => (
                    <div key={k} className="grid grid-cols-[160px_1fr] gap-3 rounded-md border bg-secondary/40 p-2.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</span>
                      <span className="break-words font-mono text-sm">
                        {collected[k] || <span className="italic text-muted-foreground">not provided</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bottom-right: Transcript (per-stage tabs; fixed-height, scrollable inside) */}
          <Card>
            <CardHeader className="space-y-2">
              <CardTitle className="text-base">Transcript</CardTitle>
              {stages.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {stages.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setActiveStage(i)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                        i === activeIdx
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {i + 1}. {s.label}
                    </button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="h-[460px]">
              <Transcript lines={stages[activeIdx]?.lines ?? detail.transcript} emptyText="No transcript yet." />
            </CardContent>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}

function BuyingIntentGauge({ score }: { score: number | null }) {
  const cx = 100, cy = 100, r = 80;
  const polar = (angle: number, rad = r): [number, number] => {
    const a = (angle * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const arc = (a1: number, a2: number) => {
    const [x1, y1] = polar(a1);
    const [x2, y2] = polar(a2);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const has = score != null;
  const s = Math.max(0, Math.min(100, score ?? 0));
  const angle = 180 * (1 - s / 100); // score 0 → 180° (left), 100 → 0° (right)
  const [nx, ny] = polar(angle, r - 16);
  const color = !has ? "#9ca3af" : s >= 70 ? "#16a34a" : s >= 50 ? "#eab308" : "#dc2626";
  const label = !has ? "" : s >= 70 ? "High intent" : s >= 50 ? "Medium intent" : "Low intent";
  return (
    <svg viewBox="0 0 200 124" className="h-32 w-56 shrink-0">
      {/* colored track: red 0-49, yellow 50-69, green 70-100 */}
      <path d={arc(180, 90)} fill="none" stroke="#dc2626" strokeWidth={16} />
      <path d={arc(90, 54)} fill="none" stroke="#eab308" strokeWidth={16} />
      <path d={arc(54, 0)} fill="none" stroke="#16a34a" strokeWidth={16} />
      {/* needle */}
      {has && <line x1={cx} y1={cy} x2={nx} y2={ny} strokeWidth={3} className="stroke-foreground" />}
      <circle cx={cx} cy={cy} r={5} className="fill-foreground" />
      {/* score in the center */}
      <text x={cx} y={88} textAnchor="middle" fontSize="26" fontWeight="700" fill={color}>
        {has ? s : "—"}
        <tspan fontSize="12" className="fill-muted-foreground">/100</tspan>
      </text>
      {label && (
        <text x={cx} y={116} textAnchor="middle" fontSize="11" className="fill-muted-foreground">{label}</text>
      )}
    </svg>
  );
}

interface StageGroup { key: number; label: string; lines: TranscriptLine[]; }

// Group transcript lines by execution (stage_no), in order. Same agent run multiple times
// becomes separate groups. Falls back to one group for older, untagged transcripts.
function buildStages(lines: TranscriptLine[]): StageGroup[] {
  if (!lines.some((l) => l.stage_no != null)) {
    return lines.length ? [{ key: 0, label: "Full transcript", lines }] : [];
  }
  const byStage = new Map<number, TranscriptLine[]>();
  for (const l of lines) {
    const k = l.stage_no ?? 0;
    if (!byStage.has(k)) byStage.set(k, []);
    byStage.get(k)!.push(l);
  }
  const groups = [...byStage.keys()].sort((a, b) => a - b).map((k) => {
    const ls = byStage.get(k)!;
    const raw = ls.find((l) => l.stage)?.stage || ls.find((l) => l.agent)?.agent || `Stage ${k}`;
    return { key: k, label: raw.replace(/^Stage\s*\d+:\s*/i, ""), lines: ls }; // "Stage 1: Aria" -> "Aria"
  });
  // Same agent appearing multiple times → mark each later execution as a separate attempt.
  const seen = new Map<string, number>();
  return groups.map((g) => {
    const n = (seen.get(g.label) ?? 0) + 1;
    seen.set(g.label, n);
    return n > 1 ? { ...g, label: `${g.label} (attempt ${n})` } : g;
  });
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
