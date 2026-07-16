// Client-side helpers for the Human Transfers UI. Pure presentation/inference over data the
// existing endpoints already return — no backend calls, no new data.

import type { TranscriptLine } from "@/types";

export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

export function outcomeVariant(outcome: string): BadgeVariant {
  const o = (outcome || "").toUpperCase();
  if (o.includes("APPOINTMENT") || o.includes("QUALIFIED") || o.includes("INTERESTED")) return "success";
  if (o.includes("CALLBACK")) return "warning";
  if (o.includes("NOT_INTERESTED") || o.includes("WRONG")) return "destructive";
  if (o.includes("HUMAN") || o.includes("TRANSFER")) return "default";
  return "muted";
}

export function isInterested(outcome: string): boolean {
  const o = (outcome || "").toUpperCase();
  return o.includes("INTERESTED") && !o.includes("NOT_INTERESTED") ? true : o.includes("QUALIFIED");
}

export function isAppointment(outcome: string): boolean {
  return (outcome || "").toUpperCase().includes("APPOINTMENT");
}

// Status shown for a transfer (there is no follow-up tracking field, so this is derived).
export function transferStatus(outcome: string): { label: string; variant: BadgeVariant } {
  if (isAppointment(outcome)) return { label: "Scheduled", variant: "success" };
  return { label: "Pending", variant: "warning" };
}

// Client-side next-action suggestion from the final outcome (no backend logic).
export function nextAction(outcome: string): string {
  const o = (outcome || "").toUpperCase();
  if (o.includes("APPOINTMENT")) return "Confirm the appointment and prepare for the meeting.";
  if (o.includes("INTERESTED") || o.includes("QUALIFIED")) return "Human follow-up recommended — call back while interest is high.";
  if (o.includes("CALLBACK")) return "Schedule a callback at the time the caller requested.";
  if (o.includes("NOT_INTERESTED")) return "Low priority — nurture later or archive.";
  return "Review the conversation and decide the next step.";
}

export function intentLabel(score: number | null | undefined): { label: string; tone: string } | null {
  if (score == null) return null;
  if (score >= 70) return { label: "High intent", tone: "text-success" };
  if (score >= 50) return { label: "Medium intent", tone: "text-warning" };
  return { label: "Low intent", tone: "text-destructive" };
}

const STOPWORDS = new Set([
  "the", "and", "you", "your", "that", "this", "with", "for", "are", "was", "but", "not", "have",
  "has", "had", "can", "could", "would", "will", "just", "okay", "yeah", "yes", "like", "what",
  "when", "how", "about", "there", "here", "they", "them", "from", "want", "need", "into", "its",
  "i'm", "it's", "that's", "we're", "you're", "don't", "really", "going", "know", "think", "right",
]);

// Top caller keywords from the EXISTING transcript (client-side only).
export function keywords(transcript: TranscriptLine[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const l of transcript || []) {
    if (l.role !== "user") continue;
    const words = (l.text || "").toLowerCase().match(/[a-z']{3,}/g) || [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
