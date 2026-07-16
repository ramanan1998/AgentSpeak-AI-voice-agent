import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, Eraser, Pencil, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Agent, DataField, RoutingRule, Workflow, WorkflowStage } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const END = "END";
const HUMAN = "HUMAN_TRANSFER";

type WorkflowRow = Workflow & { _i: number };

function agentsUsed(w: Workflow): number {
  return new Set(w.stages.map((s) => s.agent).filter(Boolean)).size;
}

const newStage = (): WorkflowStage => ({ agent: "", routing: {}, focus: [] });

export default function WorkflowsPage() {
  const [name, setName] = useState("");
  const [stages, setStages] = useState<WorkflowStage[]>([newStage()]);
  const [dataFields, setDataFields] = useState<DataField[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const loadAgents = useCallback(async () => setAgents((await api.listAgents()).agents), []);
  const loadWorkflows = useCallback(async () => setWorkflows((await api.listWorkflows()).workflows), []);
  useEffect(() => {
    void loadAgents().catch((e) => toast.error(String(e)));
    void loadWorkflows().catch((e) => toast.error(String(e)));
  }, [loadAgents, loadWorkflows]);

  const outcomesOf = (agentId: string): string[] => agents.find((a) => a.workflow_name === agentId)?.outcomes ?? [];

  const setStageAgent = (i: number, agentId: string) => {
    setStages((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s;
        const routing: Record<string, RoutingRule> = {};
        for (const o of outcomesOf(agentId)) routing[o] = s.routing[o] ?? { target: "", retry_after_days: null };
        return { agent: agentId, routing, focus: s.focus };
      }),
    );
  };
  const toggleFocus = (i: number, field: string) => {
    setStages((prev) =>
      prev.map((s, idx) =>
        idx === i
          ? { ...s, focus: s.focus.includes(field) ? s.focus.filter((f) => f !== field) : [...s.focus, field] }
          : s,
      ),
    );
  };
  const setRoute = (i: number, outcome: string, patch: Partial<RoutingRule>) => {
    setStages((prev) =>
      prev.map((s, idx) =>
        idx === i ? { ...s, routing: { ...s.routing, [outcome]: { ...(s.routing[outcome] ?? { target: "", retry_after_days: null }), ...patch } } } : s,
      ),
    );
  };
  const addStage = () => setStages((s) => [...s, newStage()]);
  const removeStage = (i: number) => setStages((s) => (s.length <= 1 ? [newStage()] : s.filter((_, idx) => idx !== i)));

  // Master-catalog field editor (the fields collected across the whole workflow).
  const fieldNames = useMemo(
    () => dataFields.map((f) => f.name.trim()).filter(Boolean),
    [dataFields],
  );
  const addField = () => setDataFields((f) => [...f, { name: "", example: "" }]);
  const updateField = (i: number, patch: Partial<DataField>) =>
    setDataFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeField = (i: number) => setDataFields((f) => f.filter((_, idx) => idx !== i));

  const reset = () => { setName(""); setStages([newStage()]); setDataFields([]); };

  const openCreate = () => { reset(); setEditing(null); setOpen(true); };

  const save = async () => {
    if (!name.trim()) return toast.warning("Workflow Name is required.");
    const valid = stages.filter((s) => s.agent);
    if (valid.length === 0) return toast.warning("Add at least one stage with an agent.");
    const data_fields = dataFields
      .filter((f) => f.name.trim())
      .map((f) => ({ name: f.name.trim(), example: f.example }));
    const names = new Set(data_fields.map((f) => f.name));
    // Drop any stale focus selections whose field was removed from the catalog.
    const cleaned = valid.map((s) => ({ ...s, focus: s.focus.filter((f) => names.has(f)) }));
    setBusy(true);
    try {
      await api.saveWorkflow({ name: name.trim(), stages: cleaned, data_fields });
      toast.success(`Saved workflow "${name.trim()}".`);
      await loadWorkflows();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const edit = async (wfName: string) => {
    try {
      const w = await api.getWorkflow(wfName);
      setName(w.name);
      setStages(w.stages.length ? w.stages.map((s) => ({ ...s, focus: s.focus ?? [] })) : [newStage()]);
      setDataFields(w.data_fields ?? []);
      setEditing(wfName);
      setOpen(true);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const del = async (wfName: string) => { await api.deleteWorkflow(wfName); await loadWorkflows(); };
  const confirmDelete = async () => {
    if (!confirmDel) return;
    try {
      await del(confirmDel);
      toast.success(`Deleted workflow "${confirmDel}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmDel(null);
    }
  };

  const rows: WorkflowRow[] = useMemo(() => workflows.map((w, i) => ({ ...w, _i: i })), [workflows]);

  const columns: Column<WorkflowRow>[] = useMemo(
    () => [
      { key: "sno", header: "S.No", className: "w-14", render: (r) => <span className="text-muted-foreground">{r._i + 1}</span> },
      { key: "name", header: "Workflow Name", sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "stages", header: "Total Stages", className: "w-28", sortable: true, sortValue: (r) => r.stages.length, render: (r) => <Badge variant="secondary">{r.stages.length}</Badge> },
      { key: "agents", header: "Agents Used", className: "w-28", sortable: true, sortValue: (r) => agentsUsed(r), render: (r) => <Badge variant="secondary">{agentsUsed(r)}</Badge> },
      {
        key: "actions",
        header: "",
        className: "w-32 text-right",
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => void edit(r.name)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDel(r.name)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <WorkflowIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Workflows ({workflows.length})</h2>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> Create Workflow</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.name}
            searchAccessor={(r) => r.name}
            searchPlaceholder="Search workflows…"
            empty="No workflows yet. Click “Create Workflow” to add one."
          />
        </CardContent>
      </Card>

      {/* Create / Edit modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><WorkflowIcon className="h-4 w-4" /> {editing ? "Edit workflow" : "Create workflow"}</DialogTitle>
            <DialogDescription>Each stage runs one agent; route each of its outcomes to another agent, End Workflow, or Human Transfer.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label>Workflow Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Real Estate Lead Qualification" />
            </div>

            <div className="space-y-2 rounded-lg border bg-secondary/30 p-4">
              <div className="flex items-center justify-between">
                <Label>Data to collect (master catalog)</Label>
                <Button variant="outline" size="sm" onClick={addField}><Plus className="h-4 w-4" /> Add field</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The full set of details collected across this journey. Every stage captures any of these
                if mentioned; each stage leads on the fields you check under “Focus”.
              </p>
              {dataFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">No fields yet. Add the information this workflow should collect.</p>
              ) : (
                <div className="space-y-2">
                  {dataFields.map((f, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                      <Input value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="Field name (e.g. Budget)" />
                      <Input value={f.example} onChange={(e) => updateField(i, { example: e.target.value })} placeholder="Example (e.g. $500k)" />
                      <Button variant="ghost" size="icon" onClick={() => removeField(i)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {stages.map((stage, i) => {
                const outs = outcomesOf(stage.agent);
                return (
                  <div key={i} className="rounded-lg border bg-secondary/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold">Stage {i + 1}</span>
                      <Button variant="ghost" size="icon" onClick={() => removeStage(i)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Agent</Label>
                      <Select value={stage.agent} onValueChange={(v) => setStageAgent(i, v)}>
                        <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                        <SelectContent>
                          {agents.map((a) => <SelectItem key={a.workflow_name} value={a.workflow_name}>{a.workflow_name} ({a.agent_name})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">Focus fields</div>
                    {fieldNames.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">Add fields to the master catalog above to assign a focus.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                        {fieldNames.map((fn) => (
                          <label key={fn} className="flex items-center gap-2 text-xs">
                            <Checkbox checked={stage.focus.includes(fn)} onCheckedChange={() => toggleFocus(i, fn)} />
                            {fn}
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">Outcome routing</div>
                    {outs.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">Select an agent that has outcomes to configure routing.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {outs.map((o) => {
                          const rule = stage.routing[o] ?? { target: "", retry_after_days: null };
                          return (
                            <div key={o} className="grid grid-cols-[1fr_1.3fr_110px] items-center gap-2">
                              <span className="font-mono text-xs">{o}</span>
                              <Select value={rule.target} onValueChange={(v) => setRoute(i, o, { target: v })}>
                                <SelectTrigger><SelectValue placeholder="route to…" /></SelectTrigger>
                                <SelectContent>
                                  {agents.map((a) => <SelectItem key={a.workflow_name} value={a.workflow_name}>{a.workflow_name}</SelectItem>)}
                                  <SelectItem value={END}>End Workflow</SelectItem>
                                  <SelectItem value={HUMAN}>Human Transfer</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                min={0}
                                step={0.5}
                                placeholder="retry days"
                                value={rule.retry_after_days ?? ""}
                                onChange={(e) => setRoute(i, o, { retry_after_days: e.target.value === "" ? null : Number(e.target.value) })}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={addStage}><Plus className="h-4 w-4" /> Add stage</Button>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={reset}><Eraser className="h-4 w-4" /> Clear</Button>
            <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Save workflow</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDel != null} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{confirmDel}</span>. This action cannot be undone.
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
