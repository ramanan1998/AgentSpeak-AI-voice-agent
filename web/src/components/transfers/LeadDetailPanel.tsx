import { useEffect, useMemo, useState } from "react";
import { X, Gauge, ArrowRight, Sparkles, FileText, Flag, MessageSquare, GitBranch } from "lucide-react";
import { api } from "@/services/api";
import type { ContactDetail, HumanTransfer, TranscriptLine } from "@/types";
import { cn } from "@/lib/utils";
import { stageSequence } from "@/lib/campaignDerive";
import { intentLabel, keywords, nextAction, outcomeVariant } from "@/lib/transfers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tab = "overview" | "timeline" | "conversation";

const TABS: { key: Tab; label: string; icon: typeof Gauge }[] = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "timeline", label: "Timeline", icon: GitBranch },
  { key: "conversation", label: "Conversation", icon: MessageSquare },
];

interface StageGroup { label: string; lines: TranscriptLine[]; }

function groupByStage(lines: TranscriptLine[]): StageGroup[] {
  if (!lines.length) return [];
  if (!lines.some((l) => l.stage_no != null)) return [{ label: "", lines }];
  const byNo = new Map<number, TranscriptLine[]>();
  for (const l of lines) {
    const k = l.stage_no ?? 0;
    if (!byNo.has(k)) byNo.set(k, []);
    byNo.get(k)!.push(l);
  }
  return [...byNo.keys()].sort((a, b) => a - b).map((k) => {
    const ls = byNo.get(k)!;
    const raw = ls.find((l) => l.stage)?.stage || ls.find((l) => l.agent)?.agent || `Stage ${k}`;
    return { label: raw.replace(/^stage\s*\d+:\s*/i, ""), lines: ls };
  });
}

export function LeadDetailPanel({ lead, onClose }: { lead: HumanTransfer; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Join to the campaign-detail responses (existing endpoints) to pull transcript / intent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setDetail(null);
      setLinked(true);
      if (!lead.campaign_id) {
        if (!cancelled) { setLinked(false); setLoading(false); }
        return;
      }
      try {
        const state = await api.campaignState(lead.campaign_id);
        const match = state.contacts.find((c) => c.phone === lead.phone);
        if (!match) {
          if (!cancelled) { setLinked(false); setLoading(false); }
          return;
        }
        const d = await api.campaignContact(match.campaign_contact_id);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setLinked(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lead]);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 250);
  };

  const groups = useMemo(() => groupByStage(detail?.transcript ?? []), [detail]);
  const kw = useMemo(() => keywords(detail?.transcript ?? []), [detail]);
  const intent = intentLabel(detail?.buying_intent_score);
  const summary = detail?.summary || lead.summary;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40 transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={close}
      />
      <div
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-background shadow-xl transition-transform duration-300",
          shown ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold">{lead.name || "Lead"}</span>
              <Badge variant={outcomeVariant(lead.final_outcome)}>{lead.final_outcome || "—"}</Badge>
            </div>
            <div className="mt-0.5 font-mono text-sm text-muted-foreground">{lead.phone}</div>
            <div className="text-xs text-muted-foreground">
              {lead.workflow_name || "—"} · Transferred —
            </div>
          </div>
          <button onClick={close} className="rounded-md p-1 text-muted-foreground hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "overview" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-primary" /> AI summary</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{summary || <span className="text-muted-foreground">No summary available.</span>}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Flag className="h-4 w-4 text-primary" /> Final outcome</CardTitle></CardHeader>
                <CardContent>
                  <Badge variant={outcomeVariant(lead.final_outcome)}>{lead.final_outcome || "—"}</Badge>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gauge className="h-4 w-4 text-primary" /> Buying intent</CardTitle></CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-6 w-24 animate-pulse rounded bg-secondary" />
                  ) : detail?.buying_intent_score != null ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums">{detail.buying_intent_score}</span>
                      <span className="text-xs text-muted-foreground">/100</span>
                      {intent && <span className={cn("text-xs font-medium", intent.tone)}>{intent.label}</span>}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not available.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ArrowRight className="h-4 w-4 text-primary" /> Recommended next action</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{nextAction(lead.final_outcome)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "timeline" && (
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Journey</CardTitle></CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-5 w-2/3 animate-pulse rounded bg-secondary" />)}</div>
                  ) : (
                    <Timeline lead={lead} stages={detail ? stageSequence(detail.transcript) : []} />
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Journey summary</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Outcome" value={lead.final_outcome || "—"} />
                  <Row label="Stages" value={detail ? String(stageSequence(detail.transcript).length) : "—"} />
                  <Row label="Messages" value={detail ? String((detail.transcript || []).length) : "—"} />
                  <Row label="Buying intent" value={detail?.buying_intent_score != null ? String(detail.buying_intent_score) : "—"} />
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "conversation" && (
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card className="flex max-h-[70vh] flex-col rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Conversation</CardTitle></CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 w-3/4 animate-pulse rounded bg-secondary" />)}</div>
                  ) : groups.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      {linked ? "No transcript available." : "Conversation not linked to a campaign call."}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {groups.map((g, gi) => (
                        <div key={gi} className="flex flex-col gap-2">
                          {g.label && (
                            <div className="my-1 flex items-center gap-2">
                              <span className="h-px flex-1 bg-border" />
                              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</span>
                              <span className="h-px flex-1 bg-border" />
                            </div>
                          )}
                          {g.lines.map((l, li) => (
                            <div key={li} className={cn("flex flex-col", l.role === "user" ? "items-end" : "items-start")}>
                              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {l.role === "user" ? "Caller" : "Assistant"}
                              </span>
                              <div className={cn(
                                "max-w-[88%] rounded-lg px-3 py-1.5 text-sm leading-relaxed",
                                l.role === "user" ? "bg-secondary text-foreground" : "bg-accent text-accent-foreground",
                              )}>
                                {l.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Conversation insights</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Outcome</div>
                    <Badge variant={outcomeVariant(lead.final_outcome)}>{lead.final_outcome || "—"}</Badge>
                  </div>
                  {intent && (
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Intent</div>
                      <span className={cn("font-medium", intent.tone)}>{intent.label}</span>
                    </div>
                  )}
                  {kw.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Keywords</div>
                      <div className="flex flex-wrap gap-1.5">
                        {kw.map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ lead, stages }: { lead: HumanTransfer; stages: string[] }) {
  const nodes = [
    { label: "Lead entered campaign", note: lead.workflow_name || "Campaign workflow" },
    ...stages.map((s) => ({ label: `Spoke with ${s}`, note: "AI agent call" })),
    { label: "Transferred to human", note: lead.final_outcome || "Routed for follow-up" },
  ];
  return (
    <ol className="relative ml-2 space-y-4 border-l pl-5">
      {nodes.map((n, i) => (
        <li key={i} className="relative">
          <span className={cn(
            "absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-background",
            i === nodes.length - 1 ? "bg-primary" : "bg-muted-foreground/60",
          )} />
          <div className="text-sm font-medium">{n.label}</div>
          <div className="text-xs text-muted-foreground">{n.note}</div>
        </li>
      ))}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
