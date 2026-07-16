import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/types";
import { cn } from "@/lib/utils";

interface TranscriptProps {
  lines: TranscriptLine[];
  emptyText?: string;
  className?: string;
}

/**
 * Flicker-free transcript: lines are only ever appended, keyed by index, so React
 * never re-renders existing rows. Auto-scrolls to the bottom only when the user is
 * already near the bottom (so manual scroll-up isn't fought).
 */
export function Transcript({ lines, emptyText = "No conversation yet.", className }: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  if (lines.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-muted-foreground", className)}>
        {emptyText}
      </div>
    );
  }

  return (
    <div ref={ref} onScroll={onScroll} className={cn("flex h-full flex-col gap-2 overflow-y-auto pr-1", className)}>
      {lines.map((l, i) => (
        <div key={i} className={cn("flex flex-col", l.role === "user" ? "items-end" : "items-start")}>
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {l.role === "user" ? "Caller" : "Assistant"}
          </span>
          <div
            className={cn(
              "max-w-[88%] rounded-lg px-3 py-1.5 text-sm leading-relaxed",
              l.role === "user" ? "bg-secondary text-foreground" : "bg-accent text-accent-foreground",
            )}
          >
            {l.text}
          </div>
        </div>
      ))}
    </div>
  );
}
