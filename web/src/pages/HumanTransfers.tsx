import { useMemo, useState } from "react";
import { UserCheck, Users, Clock, ThumbsUp, CalendarCheck, Percent, Search, ArrowUpRight } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/services/api";
import type { HumanTransfer } from "@/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeadDetailPanel } from "@/components/transfers/LeadDetailPanel";
import { isAppointment, isInterested, outcomeVariant, transferStatus } from "@/lib/transfers";

const ALL = "__all__";
const CARD = "rounded-2xl shadow-sm transition-shadow hover:shadow-md";

export default function HumanTransfersPage() {
  const { data } = usePolling(() => api.humanTransfers(), 3000);
  const { data: analytics } = usePolling(() => api.analytics(), 5000);
  const transfers = useMemo(() => data?.transfers ?? [], [data]);

  const [selected, setSelected] = useState<HumanTransfer | null>(null);
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState(ALL);
  const [outcomeFilter, setOutcomeFilter] = useState(ALL);
  const [sort, setSort] = useState("default");

  const kpis = useMemo(() => {
    const total = transfers.length;
    const pending = transfers.filter((t) => !isAppointment(t.final_outcome)).length;
    const interested = transfers.filter((t) => isInterested(t.final_outcome)).length;
    const appointments = transfers.filter((t) => isAppointment(t.final_outcome)).length;
    const rate = analytics && analytics.total_contacts
      ? `${Math.round((analytics.human_transfers / analytics.total_contacts) * 1000) / 10}%`
      : "—";
    return { total, pending, interested, appointments, rate };
  }, [transfers, analytics]);

  const workflowOptions = useMemo(
    () => [...new Set(transfers.map((t) => t.workflow_name).filter(Boolean))].sort(),
    [transfers],
  );
  const outcomeOptions = useMemo(
    () => [...new Set(transfers.map((t) => t.final_outcome).filter(Boolean))].sort(),
    [transfers],
  );

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    let out = transfers.filter((t) => {
      if (q && !`${t.name} ${t.phone} ${t.workflow_name}`.toLowerCase().includes(q)) return false;
      if (workflowFilter !== ALL && t.workflow_name !== workflowFilter) return false;
      if (outcomeFilter !== ALL && t.final_outcome !== outcomeFilter) return false;
      return true;
    });
    if (sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "outcome") out = [...out].sort((a, b) => a.final_outcome.localeCompare(b.final_outcome));
    else if (sort === "workflow") out = [...out].sort((a, b) => a.workflow_name.localeCompare(b.workflow_name));
    return out;
  }, [transfers, search, workflowFilter, outcomeFilter, sort]);

  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <UserCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Human Transfers</h2>
          <p className="text-sm text-muted-foreground">Contacts routed from campaigns for human follow-up</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total Transfers" value={kpis.total} icon={Users} />
        <Kpi label="Pending Follow-up" value={kpis.pending} icon={Clock} accent="text-warning" />
        <Kpi label="Interested" value={kpis.interested} icon={ThumbsUp} accent="text-success" />
        <Kpi label="Appointment Booked" value={kpis.appointments} icon={CalendarCheck} accent="text-success" />
        <Kpi label="Transfer Rate" value={kpis.rate} icon={Percent} accent="text-primary" />
      </div>

      {/* Toolbar + table */}
      <Card className={CARD}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…" className="pl-9" />
            </div>
            <select className={selectCls} value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
              <option value={ALL}>All workflows</option>
              {workflowOptions.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <select className={selectCls} value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
              <option value={ALL}>All outcomes</option>
              {outcomeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="default">Sort: Default</option>
              <option value="name">Sort: Name</option>
              <option value="outcome">Sort: Outcome</option>
              <option value="workflow">Sort: Workflow</option>
            </select>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <UserCheck className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No leads handed off yet</p>
              <p className="text-xs text-muted-foreground">Contacts routed to Human Transfer by a workflow will appear here.</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-secondary/80 backdrop-blur">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="p-2.5">Contact</th>
                    <th className="p-2.5">Phone</th>
                    <th className="p-2.5">Workflow</th>
                    <th className="p-2.5">Final Outcome</th>
                    <th className="p-2.5">Transfer Time</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const status = transferStatus(t.final_outcome);
                    return (
                      <tr
                        key={t.id}
                        className="cursor-pointer border-t transition-colors hover:bg-secondary/50"
                        onClick={() => setSelected(t)}
                      >
                        <td className="p-2.5 font-medium">{t.name}</td>
                        <td className="p-2.5 font-mono text-xs text-muted-foreground">{t.phone}</td>
                        <td className="p-2.5">{t.workflow_name || "—"}</td>
                        <td className="p-2.5"><Badge variant={outcomeVariant(t.final_outcome)}>{t.final_outcome || "—"}</Badge></td>
                        <td className="p-2.5 text-muted-foreground">—</td>
                        <td className="p-2.5"><Badge variant={status.variant}>{status.label}</Badge></td>
                        <td className="p-2.5 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSelected(t); }}
                          >
                            Open Lead <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <LeadDetailPanel lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, accent }: {
  label: string; value: string | number; icon: typeof Users; accent?: string;
}) {
  return (
    <Card className={CARD}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", accent)}>{value}</div>
      </CardContent>
    </Card>
  );
}
