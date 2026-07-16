import { useEffect, useState } from "react";
import { api } from "@/services/api";
import type { ContactDetail } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Transcript } from "@/components/Transcript";

export type DetailKind = "transcript" | "summary" | "collected";

const TITLES: Record<DetailKind, string> = {
  transcript: "Transcript",
  summary: "AI Summary",
  collected: "Collected Data",
};

interface Props {
  contactId: string | null;
  kind: DetailKind;
  onClose: () => void;
}

export function ContactDetailDialog({ contactId, kind, onClose }: Props) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);

  useEffect(() => {
    if (contactId == null) {
      setDetail(null);
      return;
    }
    let active = true;
    api.campaignContact(contactId).then((d) => active && setDetail(d)).catch(() => active && setDetail(null));
    return () => {
      active = false;
    };
  }, [contactId]);

  return (
    <Dialog open={contactId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {TITLES[kind]}
            {detail ? ` — ${detail.name}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {!detail ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : kind === "summary" ? (
            detail.summary ? (
              <p className="text-sm leading-relaxed">{detail.summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No summary yet{detail.status === "Finished" ? "" : " (call not finished)"}.</p>
            )
          ) : kind === "collected" ? (
            <CollectedView data={detail.collected} status={detail.status} />
          ) : (
            <div className="h-[50vh]">
              <Transcript lines={detail.transcript} emptyText="No transcript yet." />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CollectedView({ data, status }: { data: Record<string, string>; status: string }) {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">No data collected{status === "Finished" ? "" : " (call not finished)"}.</p>;
  }
  return (
    <div className="space-y-2">
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[150px_1fr] gap-3 rounded-md border bg-secondary/40 p-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</span>
          <span className="break-words font-mono text-sm">{data[k] || <span className="italic text-muted-foreground">not provided</span>}</span>
        </div>
      ))}
    </div>
  );
}
