import { useEffect, useState } from "react";

import { fetchState } from "@/lib/api";
import type { DemoState } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;

export interface DemoStateResult {
  /** Latest successful projection, or null until the first poll succeeds. */
  state: DemoState | null;
  /** Last poll error message, cleared on the next success. */
  error: string | null;
}

/**
 * Polls `GET /api/state` every second. The dashboard is a pure function of `state`;
 * a transient `error` is surfaced without discarding the last good state.
 */
export function useDemoState(): DemoStateResult {
  const [state, setState] = useState<DemoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await fetchState();
        if (!active) return;
        setState(next);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "connection failed");
      } finally {
        if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return { state, error };
}
