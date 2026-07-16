import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, PlayCircle, Square, RotateCcw, LayoutDashboard, Kanban, Users, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { usePolling } from "@/hooks/usePolling";
import { useContactDetails } from "@/hooks/useContactDetails";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OverviewTab } from "@/components/campaign/OverviewTab";
import { KanbanBoard } from "@/components/campaign/KanbanBoard";
import { ContactsTab } from "@/components/campaign/ContactsTab";
import { AnalyticsTab } from "@/components/campaign/AnalyticsTab";

// New campaign experience: Overview / Kanban Board / Contacts / Analytics.
// (Call Logs and Settings are intentionally not part of the navigation.)
const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "kanban", label: "Kanban Board", icon: Kanban },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function CampaignDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: state } = usePolling(() => api.campaignState(id), 1500);
  const [tab, setTab] = useState<TabKey>("overview");

  // Option A: enrich the views (buying intent, transitions, agent perf) via the existing
  // per-contact endpoint — no backend changes.
  const contactIds = useMemo(
    () => (state?.contacts ?? []).map((c) => c.campaign_contact_id),
    [state?.contacts],
  );
  const detailsById = useContactDetails(contactIds);

  const hasCampaign = (state?.progress?.total ?? 0) > 0;
  const openContact = (contactId: string) => navigate(`/campaigns/${id}/contact/${contactId}`);

  const start = async () => {
    if (!id) return;
    try {
      await api.startCampaign(id);
      toast.success("Campaign started.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const resetCampaign = async () => {
    try {
      await api.resetCampaign(id);
      toast.success("Campaign reset.");
      navigate("/campaigns");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const pause = async () => {
    if (!id) return;
    try {
      await api.pauseCampaign(id);
      toast.success("Campaign paused — the current call will finish.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const resume = async () => {
    if (!id) return;
    try {
      await api.resumeCampaign(id);
      toast.success("Campaign resumed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = async () => {
    if (!id) return;
    try {
      await api.stopCampaign(id);
      toast.success("Campaign stopped. Data is kept and stays viewable.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header — name + workflow (used as description) on the left; status + actions on the right. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/campaigns")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h2 className="text-lg font-semibold">{state?.campaign_name || "Campaign"}</h2>
            <p className="text-sm text-muted-foreground">{state?.workflow || "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              state?.status === "paused"
                ? "warning"
                : state?.status === "running"
                  ? "success"
                  : state?.status === "stopped"
                    ? "destructive"
                    : state?.status === "done"
                      ? "secondary"
                      : "muted"
            }
          >
            {state?.status === "paused"
              ? "Paused"
              : state?.status === "running"
                ? "Running"
                : state?.status === "stopped"
                  ? "Stopped"
                  : state?.status === "done"
                    ? "Completed"
                    : "Idle"}
          </Badge>
          {state?.paused ? (
            <Button
              onClick={() => void resume()}
              disabled={!hasCampaign}
              className="bg-[#16a34a] text-white hover:bg-[#16a34a]/90"
            >
              <PlayCircle className="h-4 w-4" /> Resume
            </Button>
          ) : (
            <Button onClick={() => void pause()} disabled={!hasCampaign || !(state?.running ?? false)}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => void stop()}
            disabled={!hasCampaign || !((state?.running ?? false) || (state?.paused ?? false))}
          >
            <Square className="h-4 w-4" /> Stop
          </Button>
          <Button variant="outline" onClick={() => void resetCampaign()} disabled={!hasCampaign}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
          <Button
            onClick={() => void start()}
            disabled={!hasCampaign || (state?.running ?? false) || (state?.paused ?? false)}
          >
            <Play className="h-4 w-4" /> Start
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {!hasCampaign || !state ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            No active campaign. Create and start one from the Campaigns page.
          </CardContent>
        </Card>
      ) : (
        <>
          {tab === "overview" && <OverviewTab state={state} detailsById={detailsById} />}
          {tab === "kanban" && <KanbanBoard state={state} detailsById={detailsById} onOpen={openContact} />}
          {tab === "contacts" && <ContactsTab state={state} detailsById={detailsById} onOpen={openContact} />}
          {tab === "analytics" && <AnalyticsTab state={state} detailsById={detailsById} />}
        </>
      )}
    </div>
  );
}
