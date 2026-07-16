import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, Megaphone, Search, Plus, Eye, Trash2, ChevronLeft, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Contact, Workflow } from "@/types";
import { usePolling } from "@/hooks/usePolling";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const ALL = "__all__";
const STEP_LABELS = ["Campaign Details", "Add Contacts", "Review & Confirm"];

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

interface CampaignRow {
  id: string;
  sno: number;
  name: string;
  workflow: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  created: string;
}

export default function CampaignsPage() {
  const navigate = useNavigate();
  const { data: list } = usePolling(() => api.listCampaigns(), 2000);

  // ---- create-campaign wizard state ----
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadSetup = useCallback(async () => {
    const [w, c, t] = await Promise.all([api.listWorkflows(), api.listContacts(), api.contactTags()]);
    setWorkflows(w.workflows);
    setContacts(c.contacts);
    setTags(t.tags);
  }, []);
  useEffect(() => { void loadSetup().catch((e) => toast.error(String(e))); }, [loadSetup]);

  const visibleContacts = useMemo(() => {
    const q = search.toLowerCase().trim();
    return contacts.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)) &&
        (tagFilter === ALL || c.tags.includes(tagFilter)),
    );
  }, [contacts, search, tagFilter]);

  const selectedContacts = useMemo(() => contacts.filter((c) => selected.has(c.id)), [contacts, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectShown = () => {
    const allOn = visibleContacts.every((c) => selected.has(c.id));
    setSelected((prev) => {
      const next = new Set(prev);
      visibleContacts.forEach((c) => (allOn ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  };

  const openCreate = () => { void loadSetup().catch(() => undefined); setStep(1); setOpen(true); };

  const step1Valid = name.trim().length > 0 && workflow.length > 0;
  const step2Valid = selected.size > 0;

  const create = async () => {
    if (!name.trim()) return toast.warning("Enter a Campaign Name.");
    if (!workflow) return toast.warning("Select a Workflow.");
    if (selected.size === 0) return toast.warning("Select at least one contact.");
    try {
      const created = name.trim();
      const res = await api.createCampaign(created, workflow, [...selected]);
      toast.success(`Campaign "${created}" created with ${res.count} contact(s).`);
      setOpen(false);
      navigate(`/campaigns/${encodeURIComponent(res.campaign_id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const rows: CampaignRow[] = useMemo(() => {
    const campaigns = list?.campaigns ?? [];
    return campaigns.map((c, i) => {
      const completed = c.status === "done" || (c.total > 0 && c.done === c.total);
      let statusLabel = "Idle";
      let statusVariant: BadgeVariant = "muted";
      if (c.running) {
        statusLabel = "Running";
        statusVariant = "success";
      } else if (c.status === "paused") {
        statusLabel = "Paused";
        statusVariant = "warning";
      } else if (c.status === "stopped") {
        statusLabel = "Stopped";
        statusVariant = "destructive";
      } else if (completed) {
        statusLabel = "Completed";
        statusVariant = "default";
      }
      return {
        id: c.campaign_id,
        sno: i + 1,
        name: c.name,
        workflow: c.workflow || "—",
        statusLabel,
        statusVariant,
        created: c.created_at ? new Date(c.created_at).toLocaleString() : "—",
      };
    });
  }, [list]);

  const delName = useMemo(() => rows.find((r) => r.id === confirmDel)?.name ?? "", [rows, confirmDel]);

  const confirmDelete = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteCampaign(confirmDel);
      toast.success(`Deleted campaign "${delName}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmDel(null);
    }
  };

  const columns: Column<CampaignRow>[] = useMemo(
    () => [
      { key: "sno", header: "S.No", className: "w-14", render: (r) => <span className="text-muted-foreground">{r.sno}</span> },
      { key: "name", header: "Campaign Name", sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "workflow", header: "Workflow", render: (r) => <span className="text-sm">{r.workflow}</span> },
      { key: "status", header: "Status", render: (r) => <Badge variant={r.statusVariant}>{r.statusLabel}</Badge> },
      { key: "created", header: "Created Time", render: (r) => <span className="text-xs text-muted-foreground">{r.created}</span> },
      {
        key: "actions",
        header: "",
        className: "w-32 text-right",
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => navigate(`/campaigns/${encodeURIComponent(r.id)}`)}><Eye className="h-3.5 w-3.5" /> View</Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDel(r.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Campaigns ({rows.length})</h2>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> Create Campaign</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            searchAccessor={(r) => `${r.name} ${r.workflow}`}
            searchPlaceholder="Search campaigns…"
            empty="No campaigns yet. Click “Create Campaign” to add one."
          />
        </CardContent>
      </Card>

      {/* ---- create campaign wizard ---- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Create New Campaign</DialogTitle>
            <DialogDescription>Let's set up your campaign in a few simple steps.</DialogDescription>
          </DialogHeader>

          {/* progress indicator */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex flex-1 items-center gap-2 last:flex-none">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                      s === step
                        ? "border-primary bg-primary text-primary-foreground"
                        : s < step
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {s < step ? <Check className="h-3.5 w-3.5" /> : s}
                  </span>
                  {s < 3 && <span className={cn("h-px flex-1", s < step ? "bg-primary" : "bg-border")} />}
                </div>
              ))}
            </div>
            <div className="text-sm">
              <span className="font-medium">Step {step} of 3</span>
              <span className="text-muted-foreground"> · {STEP_LABELS[step - 1]}</span>
            </div>
          </div>

          {/* ---- Step 1: Campaign Details ---- */}
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Campaign Name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="March Outreach" />
              </div>
              <div className="space-y-1.5">
                <Label>Workflow <span className="text-destructive">*</span></Label>
                <Select value={workflow} onValueChange={setWorkflow}>
                  <SelectTrigger><SelectValue placeholder="Select workflow" /></SelectTrigger>
                  <SelectContent>
                    {workflows.map((w) => <SelectItem key={w.name} value={w.name}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ---- Step 2: Add Contacts ---- */}
          {step === 2 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Select contacts {selected.size > 0 && <span className="text-muted-foreground">· {selected.size} selected</span>}</Label>
                <Button variant="ghost" size="sm" onClick={selectShown}><ListChecks className="h-4 w-4" /> Select shown</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number…" className="pl-9" />
                </div>
                <Select value={tagFilter} onValueChange={setTagFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All tags" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All tags</SelectItem>
                    {tags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                {visibleContacts.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No contacts — add some on the Contacts page.</div>
                ) : (
                  visibleContacts.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-secondary/50">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.phone}</span>
                      <span className="ml-auto flex flex-wrap gap-1">
                        {c.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ---- Step 3: Review & Confirm ---- */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2 rounded-lg border bg-secondary/40 p-4 text-sm">
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Campaign Name</span>
                  <span className="font-medium">{name.trim() || "—"}</span>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Workflow</span>
                  <span className="font-medium">{workflow || "—"}</span>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Contacts</span>
                  <span className="font-medium">{selected.size}</span>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-2">
                  <span className="text-muted-foreground">Selected contacts</span>
                  <span className="flex flex-wrap gap-1">
                    {selectedContacts.length === 0
                      ? <span className="text-muted-foreground">None</span>
                      : selectedContacts.map((c) => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1 text-sm">
                  <div className="font-medium">Review Before Creating</div>
                  <p className="leading-relaxed text-muted-foreground">
                    Please verify all campaign details carefully. Once the campaign is created, it will be added to your
                    campaign list and will be ready for execution. You can still review the campaign before starting it.
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2">
            <div className="flex w-full items-center justify-between">
              <div>
                {step > 1 && (
                  <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
                )}
              </div>
              <div className="flex gap-2">
                {step === 1 && <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
                {step < 3 ? (
                  <Button
                    onClick={() => setStep(step + 1)}
                    disabled={step === 1 ? !step1Valid : !step2Valid}
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={create}><ListChecks className="h-4 w-4" /> Create Campaign</Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- delete confirmation ---- */}
      <Dialog open={confirmDel != null} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete campaign?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{delName}</span> and its results. This action cannot be undone.
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
