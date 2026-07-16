import { useState } from "react";
import { Sparkles, ArrowLeft, ArrowRight, Plus, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Agent } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const TONES = ["Calm", "Bold", "Clear"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the AI-generated draft; the parent populates the Create Agent form for review.
  onGenerated: (draft: Agent) => void;
}

export function AiAgentWizard({ open, onOpenChange, onGenerated }: Props) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [tone, setTone] = useState<string[]>([]);
  const [avoid, setAvoid] = useState("");
  const [success, setSuccess] = useState("");
  const [constraints, setConstraints] = useState("");

  const reset = () => {
    setStep(1);
    setBusy(false);
    setKnowledge("");
    setWorkflowName("");
    setAgentName("");
    setTone([]);
    setAvoid("");
    setSuccess("");
    setConstraints("");
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const toggleTone = (t: string) =>
    setTone((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const generate = async () => {
    setBusy(true);
    setStep(3);
    try {
      const res = await api.generateAgent({
        knowledge,
        workflow_name: workflowName,
        agent_name: agentName,
        tone,
        avoid,
        success,
        constraints,
      });
      if (res.missing && res.missing.length) {
        toast.warning(`AI left some fields blank: ${res.missing.join(", ")}. Please complete them before saving.`);
      } else {
        toast.success("Agent draft generated — review and save.");
      }
      onGenerated(res.agent);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Create agent with AI</DialogTitle>
          <DialogDescription>
            {step === 1 && "Paste everything the agent should know about your business."}
            {step === 2 && "A few quick questions to guide the generation."}
            {step === 3 && "Generating your agent…"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Business knowledge</Label>
              <p className="text-xs text-muted-foreground">
                Company details, products, FAQs, offers, business rules, objection handling, notes — anything useful.
              </p>
              <Textarea
                rows={12}
                value={knowledge}
                onChange={(e) => setKnowledge(e.target.value)}
                placeholder="Paste your business knowledge here…"
              />
            </div>
            <Button variant="outline" size="sm" disabled className="opacity-60">
              <Plus className="h-4 w-4" /> Upload knowledge files (coming soon)
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Workflow name</Label>
                <Input value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} placeholder="cold-lead-agent" />
              </div>
              <div className="space-y-1.5">
                <Label>Agent name</Label>
                <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Aria" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Tone</Label>
              <div className="flex gap-5">
                {TONES.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={tone.includes(t)} onCheckedChange={() => toggleTone(t)} /> {t}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>What should the agent avoid?</Label>
              <Textarea rows={2} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Never quote a final price; never pressure the caller." />
            </div>
            <div className="space-y-1.5">
              <Label>What should success mean?</Label>
              <Textarea rows={2} value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="Caller is qualified and books a site visit." />
            </div>
            <div className="space-y-1.5">
              <Label>Any constraints?</Label>
              <Textarea rows={2} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="Stay compliant; transfer to a human on payment requests." />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Creating agent with AI…</p>
            <p className="text-xs text-muted-foreground">Analyzing your knowledge and drafting the full configuration.</p>
          </div>
        )}

        {step !== 3 && (
          <DialogFooter className="mt-2">
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> Back</Button>
            )}
            {step === 1 && (
              <Button onClick={() => setStep(2)} disabled={!knowledge.trim()}>Next <ArrowRight className="h-4 w-4" /></Button>
            )}
            {step === 2 && (
              <Button onClick={() => void generate()} disabled={busy}><Wand2 className="h-4 w-4" /> Generate agent</Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
