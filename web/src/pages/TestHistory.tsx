import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, Eye, Trash2, Phone, Mic, FileAudio, FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { usePolling } from "@/hooks/usePolling";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

interface TestRow {
  id: string;
  sno: number;
  mode: "phone" | "browser";
  agent: string;
  phone: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  hasRecording: boolean;
  hasTranscript: boolean;
  created: string;
}

export default function TestHistoryPage() {
  const navigate = useNavigate();
  const { data: list } = usePolling(() => api.listTestSessions(), 3000);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const rows: TestRow[] = useMemo(() => {
    const sessions = list?.sessions ?? [];
    return sessions.map((s, i) => {
      let statusLabel = "Active";
      let statusVariant: BadgeVariant = "warning";
      if (s.status === "finished") {
        statusLabel = "Finished";
        statusVariant = "success";
      } else if (s.status === "failed") {
        statusLabel = "Failed";
        statusVariant = "destructive";
      }
      return {
        id: s.id,
        sno: i + 1,
        mode: s.mode,
        agent: s.agent_name ? `${s.agent_workflow} (${s.agent_name})` : s.agent_workflow,
        phone: s.phone || "—",
        statusLabel,
        statusVariant,
        hasRecording: s.has_recording,
        hasTranscript: s.has_transcript,
        created: s.created_at ? new Date(s.created_at).toLocaleString() : "—",
      };
    });
  }, [list]);

  const delLabel = useMemo(() => {
    const r = rows.find((x) => x.id === confirmDel);
    return r ? `${r.mode} test · ${r.agent}` : "";
  }, [rows, confirmDel]);

  const confirmDelete = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteTestSession(confirmDel);
      toast.success("Deleted test session.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmDel(null);
    }
  };

  const columns: Column<TestRow>[] = useMemo(
    () => [
      { key: "sno", header: "S.No", className: "w-14", render: (r) => <span className="text-muted-foreground">{r.sno}</span> },
      {
        key: "mode",
        header: "Type",
        render: (r) => (
          <Badge variant="secondary" className="gap-1">
            {r.mode === "phone" ? <Phone className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            {r.mode === "phone" ? "Phone" : "Browser"}
          </Badge>
        ),
      },
      { key: "agent", header: "Agent", sortable: true, sortValue: (r) => r.agent, render: (r) => <span className="font-medium">{r.agent}</span> },
      { key: "phone", header: "Phone", render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.phone}</span> },
      { key: "status", header: "Status", render: (r) => <Badge variant={r.statusVariant}>{r.statusLabel}</Badge> },
      {
        key: "artifacts",
        header: "Artifacts",
        render: (r) => (
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileAudio className={`h-4 w-4 ${r.hasRecording ? "text-primary" : "opacity-30"}`} />
            <FileText className={`h-4 w-4 ${r.hasTranscript ? "text-primary" : "opacity-30"}`} />
          </div>
        ),
      },
      { key: "created", header: "Tested Time", render: (r) => <span className="text-xs text-muted-foreground">{r.created}</span> },
      {
        key: "actions",
        header: "",
        className: "w-32 text-right",
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => navigate(`/call-history/${encodeURIComponent(r.id)}`)}>
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDel(r.id)}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Testing History ({rows.length})</h2>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            searchAccessor={(r) => `${r.agent} ${r.phone} ${r.mode}`}
            searchPlaceholder="Search by agent, number, or type…"
            empty="No test calls yet. Test an agent from the “Test your agent” page."
          />
        </CardContent>
      </Card>

      <Dialog open={confirmDel != null} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete test session?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{delLabel}</span>, including its recording and transcript. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}><Trash2 className="h-4 w-4" /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}