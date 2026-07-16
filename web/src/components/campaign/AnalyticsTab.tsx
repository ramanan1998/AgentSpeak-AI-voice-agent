import { useMemo, type ReactNode } from "react";
import { Users, TrendingUp, ArrowLeftRight, CalendarCheck, Gauge, type LucideIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CampaignState, ContactDetail } from "@/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  KANBAN_COLUMNS,
  agentPerformance,
  columnFor,
  groupCount,
  intentBuckets,
  isAppointment,
  isConverted,
  isTransfer,
  type Counted,
} from "@/lib/campaignDerive";

interface Props {
  state: CampaignState;
  detailsById: Record<string, ContactDetail>;
}

const PALETTE = ["#2B66EC", "#16a34a", "#eab308", "#dc2626", "#7F77DD", "#0F6E56"];
const CARD = "rounded-2xl shadow-sm transition-shadow hover:shadow-md";
const TOOLTIP = { borderRadius: 8, border: "1px solid hsl(0 0% 90%)", fontSize: 12 };

export function AnalyticsTab({ state, detailsById }: Props) {
  const contacts = state.contacts;
  const details = useMemo(() => Object.values(detailsById), [detailsById]);

  const metrics = useMemo(() => {
    const total = contacts.length;
    const converted = contacts.filter((c) => isConverted(c.final_outcome)).length;
    const transfers = contacts.filter((c) => isTransfer(c.current_stage, c.final_outcome)).length;
    const appointments = contacts.filter((c) => isAppointment(c.current_stage, c.final_outcome)).length;
    return {
      total,
      conversion: total ? Math.round((converted / total) * 1000) / 10 : 0,
      transfers,
      appointmentPct: total ? Math.round((appointments / total) * 1000) / 10 : 0,
    };
  }, [contacts]);

  const intent = useMemo(() => intentBuckets(details), [details]);

  const stageData = useMemo(() => {
    const counts = groupCount(contacts, (c) => columnFor(c));
    const map = new Map(counts.map((x) => [x.key, x.count] as const));
    return KANBAN_COLUMNS.map((k) => ({ key: k, count: map.get(k) ?? 0 })).filter((x) => x.count > 0);
  }, [contacts]);
  const stageTotal = stageData.reduce((s, x) => s + x.count, 0);

  const funnel = useMemo(() => {
    const map = new Map(stageData.map((x) => [x.key, x.count] as const));
    return [
      { name: "Cold", value: map.get("Cold Lead") ?? 0 },
      { name: "Retry", value: map.get("Retry") ?? 0 },
      { name: "Warm", value: map.get("Warm Lead") ?? 0 },
      { name: "Transfer", value: map.get("Human Transfer") ?? 0 },
      { name: "Booked", value: map.get("Appointment") ?? 0 },
    ];
  }, [stageData]);
  const funnelMax = Math.max(...funnel.map((f) => f.value), 1);

  const outcomeData = useMemo(
    () => groupCount(contacts.filter((c) => c.final_outcome), (c) => c.final_outcome).sort((a, b) => b.count - a.count),
    [contacts],
  );
  const outcomeTotal = outcomeData.reduce((s, x) => s + x.count, 0);

  const agents = useMemo(() => agentPerformance(details), [details]);

  return (
    <div className="space-y-6">
      {/* ── Section 2 — compact KPI grid (5 in a row) ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total Contacts" value={metrics.total} icon={Users} />
        <Kpi label="Conversion Rate" value={`${metrics.conversion}%`} icon={TrendingUp} accent="text-primary" />
        <Kpi label="Human Transfers" value={metrics.transfers} icon={ArrowLeftRight} accent="text-primary" />
        <Kpi label="Appointment %" value={`${metrics.appointmentPct}%`} icon={CalendarCheck} accent="text-success" />
        <Kpi label="Avg Buying Intent" value={intent.avg == null ? "—" : intent.avg} icon={Gauge} accent="text-success" hint={`${intent.scored} scored`} />
      </div>

      {/* ── Section 3 — main analytics row: Funnel 40% · Stage 30% · Outcome 30% ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[4fr_3fr_3fr]">
        <Card className={cn(CARD, "flex flex-col")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Funnel</CardTitle></CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-2">
              {funnel.map((f, i) => {
                const widthPct = f.value > 0 ? Math.max((f.value / funnelMax) * 100, 2) : 0;
                return (
                  <div key={f.name} className="flex items-center gap-2">
                    <div className="w-16 shrink-0 text-xs text-muted-foreground">{f.name}</div>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary/40">
                      <div className="h-full rounded-md bg-primary" style={{ width: `${widthPct}%`, opacity: 1 - i * 0.15 }} />
                    </div>
                    <div className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{f.value}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className={cn(CARD, "flex flex-col")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Stage distribution</CardTitle></CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <Donut data={stageData} total={stageTotal} centerLabel="contacts" empty="No data yet." />
          </CardContent>
        </Card>

        <Card className={cn(CARD, "flex flex-col")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Outcome distribution</CardTitle></CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <Donut data={outcomeData} total={outcomeTotal} centerLabel="outcomes" empty="No final outcomes yet." />
          </CardContent>
        </Card>
      </div>

      {/* ── Section 4 — agent performance (compact, capped height) ── */}
      <Card className={CARD}>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Agent performance</CardTitle></CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              No agent activity yet.
            </div>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="p-2">Agent</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">Conv.</th>
                    <th className="p-2 text-right">Conv. %</th>
                    <th className="p-2 text-right">Transf.</th>
                    <th className="p-2 text-right">Transf. %</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((ag) => {
                    const conv = ag.calls ? Math.round((ag.conversions / ag.calls) * 100) : 0;
                    const tr = ag.calls ? Math.round((ag.transfers / ag.calls) * 100) : 0;
                    return (
                      <tr key={ag.agent} className="border-b last:border-0">
                        <td className="p-2 font-medium">{ag.agent}</td>
                        <td className="p-2 text-right tabular-nums">{ag.calls}</td>
                        <td className="p-2 text-right tabular-nums">{ag.conversions}</td>
                        <td className="p-2 text-right tabular-nums">{conv}%</td>
                        <td className="p-2 text-right tabular-nums">{ag.transfers}</td>
                        <td className="p-2 text-right tabular-nums">{tr}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 5 — intent distribution (kept in place, compact horizontal cards) ── */}
      <Card className={CARD}>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Intent distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <IntentCard value={intent.high} label="High" helper="Score 70+" tone="text-success" />
            <IntentCard value={intent.medium} label="Medium" helper="Score 50–69" tone="text-warning" />
            <IntentCard value={intent.low} label="Low" helper="Score below 50" tone="text-destructive" />
          </div>
          {intent.scored === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No buying-intent scores yet (computed after calls finish).</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── small presentational helpers (no data logic) ──

function Kpi({ label, value, icon: Icon, accent, hint }: {
  label: string; value: ReactNode; icon: LucideIcon; accent?: string; hint?: string;
}) {
  return (
    <Card className={CARD}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", accent)}>{value}</div>
        {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function Donut({ data, total, centerLabel, empty }: {
  data: Counted[]; total: number; centerLabel: string; empty: string;
}) {
  if (data.length === 0) {
    return <div className="flex h-44 flex-1 items-center justify-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="key" cx="50%" cy="50%" innerRadius={44} outerRadius={64} paddingAngle={2}>
              {data.map((d, i) => <Cell key={d.key} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {data.map((d, i) => (
          <span key={d.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {d.key}
          </span>
        ))}
      </div>
    </div>
  );
}

function IntentCard({ value, label, helper, tone }: {
  value: number; label: string; helper: string; tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-secondary/40 p-3">
      <div className={cn("text-3xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground">{helper}</div>
      </div>
    </div>
  );
}
