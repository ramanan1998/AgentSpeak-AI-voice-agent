import { useMemo } from "react";
import { Gauge, UserRound } from "lucide-react";
import type { CampaignContactRow, CampaignState, ContactDetail } from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { KANBAN_COLUMNS, type KanbanColumn, agentFromStage, columnFor, isConverted } from "@/lib/campaignDerive";

interface Props {
  state: CampaignState;
  detailsById: Record<string, ContactDetail>;
  onOpen: (contactId: string) => void;
}

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "muted";

// Blue → active, Green → success, Yellow → pending, Gray → closed.
function badgeFor(c: CampaignContactRow): { variant: BadgeVariant; label: string } {
  if (c.status === "Calling" || c.status === "Answered") return { variant: "default", label: "Active" };
  if (c.status === "Finished" || isConverted(c.final_outcome)) return { variant: "success", label: "Success" };
  const stage = (c.current_stage || "").toLowerCase();
  if (c.final_outcome || stage.includes("completed")) return { variant: "muted", label: "Closed" };
  return { variant: "warning", label: "Pending" };
}

export function KanbanBoard({ state, detailsById, onOpen }: Props) {
  const grouped = useMemo(() => {
    const g: Record<KanbanColumn, CampaignContactRow[]> = {
      "Cold Lead": [],
      Retry: [],
      "Warm Lead": [],
      "Human Transfer": [],
      Appointment: [],
      Closed: [],
    };
    for (const c of state.contacts) g[columnFor(c)].push(c);
    return g;
  }, [state.contacts]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const items = grouped[col];
        return (
          <div key={col} className="flex w-72 shrink-0 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-medium">{col}</span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border bg-secondary/20 p-2">
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">Empty</p>
              ) : (
                items.map((c) => {
                  const detail = detailsById[c.campaign_contact_id];
                  const intent = detail?.buying_intent_score;
                  const agent = agentFromStage(c.current_stage) || "—";
                  const badge = badgeFor(c);
                  return (
                    <button
                      key={c.campaign_contact_id}
                      type="button"
                      onClick={() => onOpen(c.campaign_contact_id)}
                      className="rounded-md border bg-background p-2.5 text-left transition-colors hover:border-primary/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{c.phone}</div>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <UserRound className="h-3 w-3" /> {agent}
                        </div>
                        <div className="truncate">{c.current_stage || "—"}</div>
                        {c.final_outcome && (
                          <div className="font-mono text-primary">{c.final_outcome}</div>
                        )}
                      </div>
                      {intent != null && (
                        <div
                          className={cn(
                            "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            intent >= 70
                              ? "bg-success/10 text-success"
                              : intent >= 50
                                ? "bg-warning/10 text-warning"
                                : "bg-destructive/10 text-destructive",
                          )}
                        >
                          <Gauge className="h-3 w-3" /> {intent}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
