import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, Save, Eraser, Pencil, X, Bot, ChevronDown, LayoutTemplate, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Agent, CallerPersona, DataField, ObjectionRule } from "@/types";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/agentTemplates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/DataTable";
import { AiAgentWizard } from "@/components/AiAgentWizard";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const TONES = ["Calm", "Bold", "Clear"];
const OUTCOME_PRESETS = ["INTERESTED", "NOT_INTERESTED", "CALLBACK", "NO_ANSWER", "APPOINTMENT_BOOKED", "WRONG_NUMBER"];

const blank = (): Agent => ({
  workflow_name: "", agent_name: "", agent_role: "",
  instruction_prompt: "", negative_instructions: "",
  persona: "", tone: [], communication_style: "",
  greeting: "", sign_off: "", conversation_flow: "",
  knowledge_context: "",
  outcomes: [], handoff_rules: "", safety_rules: "",
  data_fields: [], caller_personas: [], objection_rules: [],
});

type AgentRow = Agent & { _i: number };

export default function CreateAgentPage() {
  const [form, setForm] = useState<Agent>(blank());
  const [outcomeInput, setOutcomeInput] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const load = useCallback(async () => setAgents((await api.listAgents()).agents), []);
  useEffect(() => { void load().catch((e) => toast.error(String(e))); }, [load]);

  const set = <K extends keyof Agent>(key: K, value: Agent[K]) => setForm((f) => ({ ...f, [key]: value }));

  const toggleTone = (t: string) =>
    set("tone", form.tone.includes(t) ? form.tone.filter((x) => x !== t) : [...form.tone, t]);

  const addField = () => set("data_fields", [...form.data_fields, { name: "", example: "" }]);
  const updateField = (i: number, patch: Partial<DataField>) =>
    set("data_fields", form.data_fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => set("data_fields", form.data_fields.filter((_, idx) => idx !== i));

  const addPersona = () => set("caller_personas", [...form.caller_personas, { name: "", description: "" }]);
  const updatePersona = (i: number, patch: Partial<CallerPersona>) =>
    set("caller_personas", form.caller_personas.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removePersona = (i: number) => set("caller_personas", form.caller_personas.filter((_, idx) => idx !== i));

  const addObjection = () => set("objection_rules", [...form.objection_rules, { objection: "", response: "" }]);
  const updateObjection = (i: number, patch: Partial<ObjectionRule>) =>
    set("objection_rules", form.objection_rules.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const removeObjection = (i: number) => set("objection_rules", form.objection_rules.filter((_, idx) => idx !== i));

  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "_");
  const addOutcome = (raw: string) => {
    const o = norm(raw);
    if (o && !form.outcomes.includes(o)) set("outcomes", [...form.outcomes, o]);
  };
  const removeOutcome = (o: string) => set("outcomes", form.outcomes.filter((x) => x !== o));

  const reset = () => { setForm(blank()); setOutcomeInput(""); };

  const openCreate = () => { setForm(blank()); setOutcomeInput(""); setEditing(null); setOpen(true); };

  // AI wizard generated a draft → populate the form for manual review and save.
  const onAiGenerated = (draft: Agent) => {
    setForm({ ...blank(), ...draft });
    setOutcomeInput("");
    setEditing(null);
    setOpen(true);
  };

  // Pre-fill the form from a hard-coded template (saving still creates a normal DB agent).
  const openTemplate = (t: AgentTemplate) => {
    setForm({ ...blank(), ...t.agent });
    setOutcomeInput("");
    setEditing(null);
    setOpen(true);
    toast.info(`Loaded "${t.label}" template — review and save.`);
  };

  const openEdit = async (wf: string) => {
    try {
      const a = await api.getAgent(wf);
      setForm({ ...blank(), ...a });
      setOutcomeInput("");
      setEditing(wf);
      setOpen(true);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const REQUIRED_TEXT: [keyof Agent, string][] = [
    ["workflow_name", "Workflow Name"], ["agent_name", "Agent Name"], ["agent_role", "Agent Role"],
    ["instruction_prompt", "Instruction Prompt"], ["negative_instructions", "Negative Instructions"],
    ["persona", "Persona"], ["communication_style", "Communication Style"],
    ["greeting", "Greeting"], ["sign_off", "Sign Off"], ["conversation_flow", "Conversation Flow"],
    ["knowledge_context", "Knowledge Context"], ["handoff_rules", "Handoff Rules"], ["safety_rules", "Safety Rules"],
  ];

  const save = async () => {
    const missing = REQUIRED_TEXT.find(([k]) => !(form[k] as string).trim());
    if (missing) return toast.warning(`${missing[1]} is required.`);
    if (form.tone.length === 0) return toast.warning("Select at least one Tone.");
    if (form.outcomes.length === 0) return toast.warning("Add at least one Outcome.");
    setBusy(true);
    try {
      await api.saveAgent({
        ...form,
        data_fields: form.data_fields.filter((f) => f.name.trim()),
        caller_personas: form.caller_personas.filter((p) => p.name.trim()),
        objection_rules: form.objection_rules.filter((o) => o.objection.trim()),
      });
      toast.success(`Saved agent "${form.workflow_name}".`);
      await load();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (wf: string) => { await api.deleteAgent(wf); await load(); };
  const confirmDelete = async () => {
    if (!confirmDel) return;
    try {
      await del(confirmDel);
      toast.success(`Deleted agent "${confirmDel}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmDel(null);
    }
  };

  const rows: AgentRow[] = useMemo(() => agents.map((a, i) => ({ ...a, _i: i })), [agents]);

  const columns: Column<AgentRow>[] = useMemo(
    () => [
      { key: "sno", header: "S.No", className: "w-14", render: (r) => <span className="text-muted-foreground">{r._i + 1}</span> },
      { key: "workflow_name", header: "Agent Workflow Name", sortable: true, sortValue: (r) => r.workflow_name, render: (r) => <span className="font-medium">{r.workflow_name}</span> },
      { key: "agent_name", header: "Agent Name", sortable: true, sortValue: (r) => r.agent_name, render: (r) => <span>{r.agent_name}</span> },
      { key: "outcomes", header: "Outcomes", className: "w-28", sortable: true, sortValue: (r) => r.outcomes.length, render: (r) => <Badge variant="secondary">{r.outcomes.length}</Badge> },
      { key: "fields", header: "Data Fields", className: "w-28", sortable: true, sortValue: (r) => r.data_fields.length, render: (r) => <Badge variant="secondary">{r.data_fields.length}</Badge> },
      {
        key: "actions",
        header: "",
        className: "w-32 text-right",
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => void openEdit(r.workflow_name)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDel(r.workflow_name)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
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
          <Bot className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Agents ({agents.length})</h2>
        </div>
        <div className="flex items-center">
          <Button onClick={openCreate} className="rounded-r-none"><Plus className="h-4 w-4" /> Create Agent</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label="Create options">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setAiOpen(true)}>
                <Sparkles className="h-4 w-4" /> Create with AI
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Create with a template
              </div>
              {AGENT_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => openTemplate(t)} className="flex-col items-start gap-0.5">
                  <span className="flex items-center gap-2 font-medium"><LayoutTemplate className="h-3.5 w-3.5" /> {t.label}</span>
                  <span className="pl-5 text-xs text-muted-foreground">{t.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.workflow_name}
            searchAccessor={(r) => `${r.workflow_name} ${r.agent_name}`}
            searchPlaceholder="Search agents…"
            empty="No agents yet. Click “Create Agent” to add one."
          />
        </CardContent>
      </Card>

      {/* Create / Edit modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> {editing ? "Edit agent" : "Create agent"}</DialogTitle>
            <DialogDescription>Configure the agent persona, data collection, and outcomes.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* ---- Basic Information ---- */}
            <Section title="Basic Information">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Agent Workflow Name" required hint="Unique id — selectable in campaigns/workflows.">
                  <Input value={form.workflow_name} onChange={(e) => set("workflow_name", e.target.value)} placeholder="cold-lead-agent" />
                </Field>
                <Field label="Agent Name" required hint="How the agent introduces itself.">
                  <Input value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)} placeholder="Aria" />
                </Field>
              </div>
              <Field label="Agent Role" required hint="Short role descriptor.">
                <Input value={form.agent_role} onChange={(e) => set("agent_role", e.target.value)} placeholder="Outbound real-estate lead qualifier" />
              </Field>
            </Section>

            {/* ---- Agent Personality ---- */}
            <Section title="Agent Personality">
              <Field label="Persona" required hint="Who the agent is — background and identity.">
                <Textarea rows={3} value={form.persona} onChange={(e) => set("persona", e.target.value)} placeholder="A friendly, experienced realty consultant who has helped hundreds of families find homes." />
              </Field>
              <Field label="Tone" required>
                <div className="flex gap-5">
                  {TONES.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={form.tone.includes(t)} onCheckedChange={() => toggleTone(t)} /> {t}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Communication Style" required hint="How it phrases things — pace, formality, sentence length.">
                <Textarea rows={2} value={form.communication_style} onChange={(e) => set("communication_style", e.target.value)} placeholder="Warm and concise; short sentences; mirrors the caller's energy." />
              </Field>
            </Section>

            {/* ---- Instructions ---- */}
            <Section title="Instructions">
              <Field label="Instruction Prompt" required>
                <Textarea rows={4} value={form.instruction_prompt} onChange={(e) => set("instruction_prompt", e.target.value)} placeholder="Defines the behavior, role, and purpose of the agent." />
              </Field>
              <Field label="Negative Instructions" required hint="What the agent must NOT do.">
                <Textarea rows={2} value={form.negative_instructions} onChange={(e) => set("negative_instructions", e.target.value)} placeholder="Never quote a final price; never promise availability without checking." />
              </Field>
            </Section>

            {/* ---- Conversation Setup ---- */}
            <Section title="Conversation Setup">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Greeting" required>
                  <Textarea rows={2} value={form.greeting} onChange={(e) => set("greeting", e.target.value)} placeholder="Hi, this is Aria from ABC Realty. Am I speaking with John?" />
                </Field>
                <Field label="Sign Off" required>
                  <Textarea rows={2} value={form.sign_off} onChange={(e) => set("sign_off", e.target.value)} placeholder="Thank you for your time. Have a great day." />
                </Field>
              </div>
              <Field label="Conversation Flow" required hint="Step-by-step structure the call should follow.">
                <Textarea rows={4} value={form.conversation_flow} onChange={(e) => set("conversation_flow", e.target.value)} placeholder="1. Confirm identity  2. Qualify need  3. Capture budget & location  4. Book next step" />
              </Field>
            </Section>

            {/* ---- Business Knowledge ---- */}
            <Section title="Business Knowledge">
              <Field label="Knowledge Context" required hint="Business facts and product knowledge the agent can rely on.">
                <Textarea rows={4} value={form.knowledge_context} onChange={(e) => set("knowledge_context", e.target.value)} placeholder="Project: Ocean Crest, Dubai Islands. Pre-launch pricing from 1.2M AED. Handover Q4 2027…" />
              </Field>
            </Section>

            {/* ---- Routing & Control ---- */}
            <Section title="Routing & Control">
              <Field label="Outcomes" required hint="Workflows route on these. Click a preset or add a custom one.">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {OUTCOME_PRESETS.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => addOutcome(o)}
                        className={`rounded-full border border-dashed px-2.5 py-0.5 text-xs ${form.outcomes.includes(o) ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  <div className="flex min-h-[1.5rem] flex-wrap gap-2">
                    {form.outcomes.length === 0 && <span className="text-xs text-muted-foreground">No outcomes added.</span>}
                    {form.outcomes.map((o) => (
                      <Badge key={o} className="gap-1">
                        {o}
                        <button onClick={() => removeOutcome(o)}><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={outcomeInput}
                      onChange={(e) => setOutcomeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOutcome(outcomeInput); setOutcomeInput(""); } }}
                      placeholder="Custom outcome e.g. QUALIFIED"
                    />
                    <Button variant="outline" size="sm" onClick={() => { addOutcome(outcomeInput); setOutcomeInput(""); }}><Plus className="h-4 w-4" /> Add</Button>
                  </div>
                </div>
              </Field>
              <Field label="Handoff Rules" required hint="When and how to transfer to a human.">
                <Textarea rows={2} value={form.handoff_rules} onChange={(e) => set("handoff_rules", e.target.value)} placeholder="Transfer to a human if the caller asks to speak to an agent or is ready to make a payment." />
              </Field>
              <Field label="Safety Rules" required hint="Hard guardrails and compliance limits.">
                <Textarea rows={2} value={form.safety_rules} onChange={(e) => set("safety_rules", e.target.value)} placeholder="Do not give legal or financial advice. Do not record consent without stating the call may be recorded." />
              </Field>
            </Section>

            {/* ---- Optional Configuration ---- */}
            <Section title="Optional Configuration">
              <Field label="Data Collection Fields" hint="Edit field name and example format.">
                <div className="space-y-2">
                  {form.data_fields.map((f, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="Field name (e.g. Email)" />
                      <Input value={f.example} onChange={(e) => updateField(i, { example: e.target.value })} placeholder="Example (e.g. xxx@xxx.xxx)" />
                      <Button variant="outline" size="icon" onClick={() => removeField(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addField}><Plus className="h-4 w-4" /> Add field</Button>
                </div>
              </Field>

              <Field label="Caller Personas" hint="Types of callers the agent may face, and how to handle each.">
                <div className="space-y-2">
                  {form.caller_personas.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] gap-2">
                      <Input value={p.name} onChange={(e) => updatePersona(i, { name: e.target.value })} placeholder="Persona (e.g. Busy professional)" />
                      <Input value={p.description} onChange={(e) => updatePersona(i, { description: e.target.value })} placeholder="How to handle them" />
                      <Button variant="outline" size="icon" onClick={() => removePersona(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addPersona}><Plus className="h-4 w-4" /> Add persona</Button>
                </div>
              </Field>

              <Field label="Objection Rules" hint="Common objections and the response to give.">
                <div className="space-y-2">
                  {form.objection_rules.map((o, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] gap-2">
                      <Input value={o.objection} onChange={(e) => updateObjection(i, { objection: e.target.value })} placeholder="Objection (e.g. Too expensive)" />
                      <Input value={o.response} onChange={(e) => updateObjection(i, { response: e.target.value })} placeholder="Response" />
                      <Button variant="outline" size="icon" onClick={() => removeObjection(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addObjection}><Plus className="h-4 w-4" /> Add objection</Button>
                </div>
              </Field>
            </Section>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={reset}><Eraser className="h-4 w-4" /> Clear</Button>
            <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Save agent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDel != null} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete agent?</DialogTitle>
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

      {/* Create with AI wizard — generates a draft, then opens the form above for review. */}
      <AiAgentWizard open={aiOpen} onOpenChange={setAiOpen} onGenerated={onAiGenerated} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-lg border bg-secondary/20 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label} {required && <span className="text-destructive">*</span>}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
