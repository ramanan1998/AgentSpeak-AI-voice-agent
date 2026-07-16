// Client-side derivations for the campaign views. NO backend calls here — everything
// is computed from data the existing endpoints already return:
//   * CampaignContactRow  (GET /campaign/state contacts[])
//   * ContactDetail       (GET /campaign/contact/{id}, fetched per-contact — "Option A")
// Stage labels are workflow-defined strings (e.g. "Stage 1: Aria", "Retry → Aria (~2d)",
// "Human Transfer", "Completed"), so mapping is heuristic but stable.

import type { CampaignContactRow, ContactDetail, TranscriptLine } from "@/types";

export const KANBAN_COLUMNS = [
  "Cold Lead",
  "Retry",
  "Warm Lead",
  "Human Transfer",
  "Appointment",
  "Closed",
] as const;
export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

const CONVERT_OUTCOMES = new Set(["QUALIFIED", "INTERESTED", "APPOINTMENT_BOOKED"]);

export function isConverted(outcome: string): boolean {
  return CONVERT_OUTCOMES.has((outcome || "").toUpperCase());
}

export function isTransfer(stage: string, outcome: string): boolean {
  const s = (stage || "").toLowerCase();
  const o = (outcome || "").toUpperCase();
  return s.includes("human transfer") || o.includes("HUMAN") || o.includes("TRANSFER");
}

export function isAppointment(stage: string, outcome: string): boolean {
  const s = (stage || "").toLowerCase();
  const o = (outcome || "").toUpperCase();
  return o.includes("APPOINTMENT") || s.includes("appointment");
}

// Map a contact to one of the six read-only Kanban columns.
export function columnFor(c: CampaignContactRow): KanbanColumn {
  const stage = (c.current_stage || "").toLowerCase();
  const outcome = c.final_outcome || "";
  if (isAppointment(stage, outcome)) return "Appointment";
  if (isTransfer(stage, outcome)) return "Human Transfer";
  const terminal = !!c.final_outcome || stage.includes("completed");
  if (terminal) return "Closed";
  if (stage.startsWith("retry")) return "Retry";
  const m = stage.match(/stage\s*(\d+)/);
  if (m && Number(m[1]) >= 2) return "Warm Lead";
  return "Cold Lead";
}

// Friendly current-agent name parsed from a current_stage label.
export function agentFromStage(stage: string): string {
  if (!stage) return "";
  let m = stage.match(/stage\s*\d+:\s*(.+)/i);
  if (m) return m[1].trim();
  m = stage.match(/(?:retry|next)\s*(?:→|->)\s*(.+?)(?:\s*\(.*\))?$/i);
  if (m) return m[1].trim();
  return "";
}

function stageNameFromLine(l: TranscriptLine): string {
  const fromStage = (l.stage || "").replace(/^stage\s*\d+:\s*/i, "").trim();
  return fromStage || (l.agent || "").trim();
}

// Ordered, distinct stage display names a contact passed through (from the tagged transcript).
export function stageSequence(transcript: TranscriptLine[]): string[] {
  const byNo = new Map<number, string>();
  for (const l of transcript || []) {
    if (l.stage_no == null) continue;
    if (!byNo.has(l.stage_no)) byNo.set(l.stage_no, stageNameFromLine(l) || `Stage ${l.stage_no}`);
  }
  return [...byNo.keys()].sort((a, b) => a - b).map((k) => byNo.get(k)!);
}

export interface Movement {
  name: string;
  from: string;
  to: string;
}

// Recent stage transitions derived from per-contact transcripts (latest available data,
// since there are no timestamps in the API).
export function recentMovements(details: ContactDetail[], limit = 8): Movement[] {
  const out: Movement[] = [];
  for (const d of details) {
    const seq = stageSequence(d.transcript || []);
    if (seq.length >= 2) out.push({ name: d.name, from: seq[seq.length - 2], to: seq[seq.length - 1] });
  }
  return out.slice(-limit).reverse();
}

export interface AgentStat {
  agent: string;
  calls: number;
  conversions: number;
  transfers: number;
}

// Per-agent performance derived from per-contact transcripts. A "call" = one distinct
// stage execution; conversion/transfer are attributed to the contact's last agent.
export function agentPerformance(details: ContactDetail[]): AgentStat[] {
  const map = new Map<string, AgentStat>();
  const get = (a: string): AgentStat => {
    let s = map.get(a);
    if (!s) {
      s = { agent: a, calls: 0, conversions: 0, transfers: 0 };
      map.set(a, s);
    }
    return s;
  };
  for (const d of details) {
    const seen = new Set<number>();
    let lastAgent = "";
    for (const l of d.transcript || []) {
      const name = stageNameFromLine(l);
      if (!name) continue;
      lastAgent = name;
      const k = l.stage_no ?? 0;
      if (!seen.has(k)) {
        seen.add(k);
        get(name).calls += 1;
      }
    }
    if (!lastAgent) continue;
    if (isConverted(d.final_outcome)) get(lastAgent).conversions += 1;
    if (isTransfer(d.current_stage, d.final_outcome)) get(lastAgent).transfers += 1;
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

export interface IntentBuckets {
  high: number;
  medium: number;
  low: number;
  scored: number;
  avg: number | null;
}

export function intentBuckets(details: ContactDetail[]): IntentBuckets {
  let high = 0,
    medium = 0,
    low = 0,
    sum = 0,
    n = 0;
  for (const d of details) {
    const s = d.buying_intent_score;
    if (s == null) continue;
    n += 1;
    sum += s;
    if (s >= 70) high += 1;
    else if (s >= 50) medium += 1;
    else low += 1;
  }
  return { high, medium, low, scored: n, avg: n ? Math.round(sum / n) : null };
}

export interface Counted {
  key: string;
  count: number;
}

export function groupCount<T>(items: T[], keyFn: (x: T) => string): Counted[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count }));
}
