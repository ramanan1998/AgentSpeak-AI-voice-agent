import { Users, PhoneCall, PhoneIncoming, PhoneMissed, BadgeCheck, UserCheck, TrendingUp, Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/services/api";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const OUTCOME_COLORS = {
  attempted: "hsl(222 83% 55%)",
  answered: "hsl(152 60% 40%)",
  noAnswer: "hsl(35 92% 50%)",
  failed: "hsl(0 72% 51%)",
};

// Shared polish for the dashboard's own section cards (KPI cards keep their existing look).
const SECTION_CARD = "rounded-2xl shadow-sm transition-shadow hover:shadow-md";

export default function DashboardPage() {
  const { data: analytics } = usePolling(() => api.analytics(), 4000);
  const { data: campaign } = usePolling(() => api.campaignState(), 2500);

  const a = analytics;

  const chartData = [
    { name: "Attempted", value: a?.calls_attempted ?? 0, fill: OUTCOME_COLORS.attempted },
    { name: "Answered", value: a?.calls_answered ?? 0, fill: OUTCOME_COLORS.answered },
    { name: "No Answer", value: a?.no_answer ?? 0, fill: OUTCOME_COLORS.noAnswer },
    { name: "Failed", value: a?.failed ?? 0, fill: OUTCOME_COLORS.failed },
  ];

  // Conversion funnel — same /analytics scalars arranged as a drop-off story.
  const funnelStages = [
    { name: "Total Contacts", value: a?.total_contacts ?? 0 },
    { name: "Calls Attempted", value: a?.calls_attempted ?? 0 },
    { name: "Calls Answered", value: a?.calls_answered ?? 0 },
    { name: "Qualified Leads", value: a?.qualified_leads ?? 0 },
    { name: "Human Transfers", value: a?.human_transfers ?? 0 },
  ];
  const funnelMax = Math.max(...funnelStages.map((s) => s.value), 1);
  const funnelTotal = funnelStages[0].value;

  // Status badge for the active-campaign summary (uses the existing campaign.status field).
  const st = campaign?.status;
  const statusLabel =
    st === "running" ? "Running"
    : st === "paused" ? "Paused"
    : st === "stopped" ? "Stopped"
    : st === "done" ? "Completed"
    : campaign?.running ? "Running" : "Idle";
  const statusVariant =
    st === "running" ? "success"
    : st === "paused" ? "warning"
    : st === "stopped" ? "destructive"
    : st === "done" ? "secondary"
    : campaign?.running ? "success" : "muted";

  const hasCampaign = !!campaign && campaign.progress.total > 0;

  return (
    <div className="space-y-6">
      {/* ── Section 1 — KPI row (2 × 4, existing cards/colors/values) ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Contacts" value={a?.total_contacts ?? 0} icon={Users} />
        <StatCard label="Calls Attempted" value={a?.calls_attempted ?? 0} icon={PhoneCall} />
        <StatCard label="Calls Answered" value={a?.calls_answered ?? 0} icon={PhoneIncoming} accent="success" />
        <StatCard label="No Answer" value={a?.no_answer ?? 0} icon={PhoneMissed} accent="warning" />
        <StatCard label="Qualified Leads" value={a?.qualified_leads ?? 0} icon={BadgeCheck} accent="success" />
        <StatCard label="Human Transfers" value={a?.human_transfers ?? 0} icon={UserCheck} accent="primary" />
        <StatCard label="Failed Calls" value={a?.failed ?? 0} icon={PhoneMissed} accent="destructive" />
        <StatCard label="Conversion Rate" value={`${a?.conversion_rate ?? 0}%`} icon={TrendingUp} accent="primary" />
      </div>

      {/* ── Section 2 — Active campaign (full width, compact summary) ── */}
      <Card className={SECTION_CARD}>
        <CardContent className="p-4">
          {hasCampaign && campaign ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* LEFT — identity */}
              <div className="min-w-0 space-y-1 lg:w-60">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{campaign.campaign_name || "Untitled"}</span>
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                </div>
                <div className="truncate text-sm text-muted-foreground">Workflow: {campaign.workflow || "—"}</div>
                {campaign.running && campaign.active_name && (
                  <div className="truncate text-xs text-muted-foreground">
                    Active: <span className="text-foreground">{campaign.active_name}</span>
                    {campaign.active_stage ? ` · ${campaign.active_stage}` : ""}
                  </div>
                )}
              </div>

              {/* CENTER — compact progress metrics */}
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["Total", campaign.progress.total],
                    ["Completed", campaign.progress.completed],
                    ["In Progress", campaign.progress.calling],
                    ["Remaining", campaign.progress.remaining],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-xl border bg-secondary/40 p-2 text-center">
                    <div className="text-lg font-semibold tabular-nums">{v}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                  </div>
                ))}
              </div>

              {/* RIGHT — headline stats + existing CTA */}
              <div className="flex items-center gap-5 lg:gap-6">
                <div className="text-center">
                  <div className="text-lg font-semibold tabular-nums text-primary">{a?.human_transfers ?? 0}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Human Transfers</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold tabular-nums text-primary">{a?.conversion_rate ?? 0}%</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Conversion</div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/campaigns"><Megaphone className="h-4 w-4" /> Go to Campaigns</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">No campaign running. Create one to start calling.</p>
              <Button asChild size="sm"><Link to="/campaigns"><Megaphone className="h-4 w-4" /> Go to Campaigns</Link></Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3 — dual analytics row (equal width, stretch to equal height) ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={SECTION_CARD}>
          <CardHeader><CardTitle className="text-base">Conversion funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {funnelStages.map((s, i) => {
                const widthPct = s.value > 0 ? Math.max((s.value / funnelMax) * 100, 2) : 0;
                const ofTotal = funnelTotal > 0 ? Math.round((s.value / funnelTotal) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-sm text-muted-foreground">{s.name}</div>
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-secondary/40">
                      <div
                        className="h-full rounded-md bg-primary"
                        style={{ width: `${widthPct}%`, opacity: 1 - i * 0.15 }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-sm">
                      <span className="font-semibold tabular-nums">{s.value}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{ofTotal}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Lead drop-off from total contacts to human transfers.</p>
          </CardContent>
        </Card>

        <Card className={SECTION_CARD}>
          <CardHeader><CardTitle className="text-base">Call outcomes</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 90%)" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(0 0% 48%)" />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="hsl(0 0% 48%)" width={32} />
                  <Tooltip
                    cursor={{ fill: "hsl(0 0% 96%)" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(0 0% 90%)", fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {chartData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Updates automatically as the campaign progresses.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
