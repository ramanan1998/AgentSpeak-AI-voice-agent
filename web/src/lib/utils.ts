import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** mm:ss from seconds */
export function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** seconds -> "320 ms" / "1.20 s" */
export function fmtMs(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const ms = seconds * 1000;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${seconds.toFixed(2)} s`;
}
