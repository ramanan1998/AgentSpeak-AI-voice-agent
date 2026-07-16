import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import type { CampaignContactRow, CampaignState, ContactDetail } from "@/types";
import { statusVariant } from "@/lib/status";
import { DataTable, type Column } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/StatCard";
import { agentFromStage, isConverted, isTransfer } from "@/lib/campaignDerive";

interface Props {
  state: CampaignState;
  detailsById: Record<string, ContactDetail>;
  onOpen: (contactId: string) => void;
}

const ALL = "__all__";

export function ContactsTab({ state, detailsById, onOpen }: Props) {
  const contacts = state.contacts;
  const [agentFilter, setAgentFilter] = useState(ALL);
  const [stageFilter, setStageFilter] = useState(ALL);
  const [outcomeFilter, setOutcomeFilter] = useState(ALL);

  const agentOptions = useMemo(
    () => [...new Set(contacts.map((c) => agentFromStage(c.current_stage)).filter(Boolean))].sort(),
    [contacts],
  );
  const stageOptions = useMemo(
    () => [...new Set(contacts.map((c) => c.current_stage).filter(Boolean))].sort(),
    [contacts],
  );
  const outcomeOptions = useMemo(
    () => [...new Set(contacts.map((c) => c.final_outcome).filter(Boolean))].sort(),
    [contacts],
  );

  const rows = useMemo(
    () =>
      contacts.filter((c) => {
        if (agentFilter !== ALL && agentFromStage(c.current_stage) !== agentFilter) return false;
        if (stageFilter !== ALL && c.current_stage !== stageFilter) return false;
        if (outcomeFilter !== ALL && c.final_outcome !== outcomeFilter) return false;
        return true;
      }),
    [contacts, agentFilter, stageFilter, outcomeFilter],
  );

  const summary = useMemo(() => {
    const converted = contacts.filter((c) => isConverted(c.final_outcome)).length;
    const transferred = contacts.filter((c) => isTransfer(c.current_stage, c.final_outcome)).length;
    const active = contacts.filter((c) => !c.final_outcome).length;
    return { total: contacts.length, converted, transferred, active };
  }, [contacts]);

  const columns: Column<CampaignContactRow>[] = useMemo(
    () => [
      { key: "name", header: "Contact", sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "phone", header: "Phone", render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.phone}</span> },
      { key: "agent", header: "Current Agent", render: (r) => <span className="text-sm">{agentFromStage(r.current_stage) || "—"}</span> },
      { key: "stage", header: "Current Stage", render: (r) => <span className="text-sm">{r.current_stage || "—"}</span> },
      {
        key: "outcome",
        header: "Final Outcome",
        render: (r) => (r.final_outcome ? <span className="font-mono text-xs text-primary">{r.final_outcome}</span> : <span className="text-muted-foreground">—</span>),
      },
      {
        key: "intent",
        header: "Buying Intent",
        className: "w-28",
        sortable: true,
        sortValue: (r) => detailsById[r.campaign_contact_id]?.buying_intent_score ?? -1,
        render: (r) => {
          const s = detailsById[r.campaign_contact_id]?.buying_intent_score;
          if (s == null) return <span className="text-muted-foreground">—</span>;
          const tone = s >= 70 ? "text-success" : s >= 50 ? "text-warning" : "text-destructive";
          return <span className={`font-semibold tabular-nums ${tone}`}>{s}</span>;
        },
      },
      { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge> },
      {
        key: "actions",
        header: "",
        className: "w-32 text-right",
        render: (r) => (
          <Button variant="outline" size="sm" onClick={() => onOpen(r.campaign_contact_id)}>
            <Eye className="h-3.5 w-3.5" /> View Details
          </Button>
        ),
      },
    ],
    [detailsById, onOpen],
  );

  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Contacts" value={summary.total} />
        <StatCard label="Converted" value={summary.converted} accent="success" />
        <StatCard label="Transferred" value={summary.transferred} accent="primary" />
        <StatCard label="Active" value={summary.active} accent="warning" />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.campaign_contact_id}
        searchAccessor={(r) => `${r.name} ${r.phone}`}
        searchPlaceholder="Search contacts…"
        pageSize={10}
        empty="No contacts match the filters."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectCls} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value={ALL}>All agents</option>
              {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className={selectCls} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value={ALL}>All stages</option>
              {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
              <option value={ALL}>All outcomes</option>
              {outcomeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        }
      />
    </div>
  );
}
