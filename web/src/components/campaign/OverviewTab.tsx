import { useMemo } from "react";
import {
  Users,
  CheckCircle2,
  PhoneIncoming,
  PhoneMissed,
  ArrowLeftRight,
  CalendarCheck,
  Clock,
  PhoneCall,
  ArrowRight,
} from "lucide-react";
import type { CampaignState, ContactDetail } from "@/types";
import { StatCard } from "@/components/StatCard";
import { Transcript } from "@/components/Transcript";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  KANBAN_COLUMNS,
  columnFor,
  groupCount,
  isAppointment,
  isTransfer,
  recentMovements,
} from "@/lib/campaignDerive";

interface Props {
  state: CampaignState;
  detailsById: Record<string, ContactDetail>;
}

export function OverviewTab({ state, detailsById }: Props) {
  const p = state.progress;
  const contacts = state.contacts;
  const done = p.completed + p.failed + p.no_answer;
  const pct = p.total ? Math.round((done / p.total) * 100) : 0;

  const answered = useMemo(
    () => contacts.filter((c) => c.status === "Answered" || c.status === "Finished").length,
    [contacts],
  );
  const transfers = useMemo(
    () => contacts.filter((c) => isTransfer(c.current_stage, c.final_outcome)).length,
    [contacts],
  );
  const appointments = useMemo(
    () => contacts.filter((c) => isAppointment(c.current_stage, c.final_outcome)).length,
    [contacts],
  );

  const stageDist = useMemo(() => {
    const counts = groupCount(contacts, (c) => columnFor(c));
    const map = new Map(counts.map((x) => [x.key, x.count] as const));
    return KANBAN_COLUMNS.map((k) => ({ key: k, count: map.get(k) ?? 0 })).filter((x) => x.count > 0);
  }, [contacts]);

  const outcomeDist = useMemo(() => {
    const withOutcome = contacts.filter((c) => c.final_outcome);
    const counts = groupCount(withOutcome, (c) => c.final_outcome).sort((a, b) => b.count - a.count);
    const total = withOutcome.length;
    return { counts, total };
  }, [contacts]);

  const movements = useMemo(
    () => recentMovements(Object.values(detailsById)),
    [detailsById],
  );

  return (
    <div className="space-y-6">
      {/* Live progress */}
      <Card>
        <CardHeader><CardTitle className="text-base">Live progress</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Progress value={pct} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <StatCard label="Total Contacts" value={p.total} icon={Users} />
            <StatCard label="Completed" value={p.completed} icon={CheckCircle2} accent="success" />
            <StatCard label="Answered" value={answered} icon={PhoneIncoming} accent="success" />
            <StatCard label="Unanswered" value={p.no_answer} icon={PhoneMissed} accent="warning" />
            <StatCard label="Human Transfers" value={transfers} icon={ArrowLeftRight} accent="primary" />
            <StatCard label="Appointment Booked" value={appointments} icon={CalendarCheck} accent="success" />
            <StatCard label="Remaining" value={p.remaining} icon={Clock} />
            <StatCard label="Calling" value={p.calling} icon={PhoneCall} accent="primary" />
          </div>
        </CardContent>
      </Card>

      {/* Live snapshots */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Current stage distribution</CardTitle></CardHeader>
          <CardContent>
            {stageDist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
            ) : (
              <div className="space-y-2.5">
                {stageDist.map((s) => {
                  const widthPct = p.total ? Math.max((s.count / p.total) * 100, 2) : 0;
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 text-sm text-muted-foreground">{s.key}</div>
                      <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary/40">
                        <div className="h-full rounded-md bg-primary" style={{ width: `${widthPct}%` }} />
                      </div>
                      <div className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{s.count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Outcome distribution</CardTitle></CardHeader>
          <CardContent>
            {outcomeDist.counts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No final outcomes yet.</p>
            ) : (
              <div className="space-y-2.5">
                {outcomeDist.counts.map((o) => {
                  const share = outcomeDist.total ? Math.round((o.count / outcomeDist.total) * 100) : 0;
                  return (
                    <div key={o.key} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 truncate font-mono text-xs text-primary">{o.key}</div>
                      <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary/40">
                        <div className="h-full rounded-md bg-primary" style={{ width: `${Math.max(share, 2)}%` }} />
                      </div>
                      <div className="w-20 shrink-0 text-right text-sm">
                        <span className="font-semibold tabular-nums">{o.count}</span>
                        <span className="ml-1 text-xs text-muted-foreground">{share}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live call + recent movement */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Live call</CardTitle>
            {state.active_name ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{state.active_name}</span>
                {state.active_stage ? ` · ${state.active_stage}` : ""}
                {state.active_status ? ` · ${state.active_status}` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{state.running ? "Waiting for the next call…" : "No active call."}</p>
            )}
          </CardHeader>
          <CardContent className="h-[320px]">
            <Transcript lines={state.active_transcript} emptyText="Live transcription will appear here." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent movement</CardTitle></CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stage transitions yet.</p>
            ) : (
              <ul className="space-y-3">
                {movements.map((m, i) => (
                  <li key={`${m.name}-${i}`} className="flex items-center gap-3 text-sm">
                    <span className="font-medium">{m.name}</span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {m.from} <ArrowRight className="h-3.5 w-3.5" /> <span className="text-foreground">{m.to}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
