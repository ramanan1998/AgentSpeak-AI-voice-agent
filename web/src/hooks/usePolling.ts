import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll an async function on an interval. Keeps the latest result + error and
 * exposes a manual refresh. The function reference can change freely without
 * resetting the interval.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): { data: T | null; error: string | null; loading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    const id = window.setInterval(() => void tick(), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, tick]);

  return { data, error, loading, refresh: tick };
}
