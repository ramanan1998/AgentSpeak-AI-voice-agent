import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import type { ContactDetail } from "@/types";

// "Option A": enrich the campaign views with per-contact fields (buying intent, last
// outcome, stage transitions) that the bulk /campaign/state row does NOT include — by
// calling the EXISTING /campaign/contact/{id} endpoint once per contact. No backend
// changes. Refreshes on a slow cadence so scores/stages stay current without hammering.
export function useContactDetails(ids: string[], refreshMs = 8000): Record<string, ContactDetail> {
  const [byId, setById] = useState<Record<string, ContactDetail>>({});
  const inFlight = useRef(false);
  const idsKey = ids.join(",");

  useEffect(() => {
    if (!ids.length) {
      setById({});
      return;
    }
    let cancelled = false;

    const fetchAll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const results = await Promise.allSettled(ids.map((id) => api.campaignContact(id)));
        if (cancelled) return;
        const next: Record<string, ContactDetail> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[ids[i]] = r.value;
        });
        setById(next);
      } finally {
        inFlight.current = false;
      }
    };

    void fetchAll();
    const t = window.setInterval(() => void fetchAll(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, refreshMs]);

  return byId;
}
