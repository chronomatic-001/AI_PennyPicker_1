import type { Approval, DemoState } from "@/lib/types";

// Backend base URL comes from the build-time env (Vite). Trailing slash trimmed so paths concat cleanly.
const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string") detail = body.error;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

/** Poll target — full demo state projection. */
export function fetchState(): Promise<DemoState> {
  return request<DemoState>("/api/state");
}

/** Generate the session beneficiary, release Event A, start the A→B chain. 409 if not IDLE. */
export function startDemo(): Promise<DemoState> {
  return request<DemoState>("/api/demo/start", { method: "POST" });
}

/** Return the demo to a pristine IDLE state. */
export function resetDemo(): Promise<{ phase: "IDLE" }> {
  return request<{ phase: "IDLE" }>("/api/demo/reset", { method: "POST" });
}

/** Settle the per-event approval gate (I-3). The only write the frontend may make beyond Start/Reset. */
export function decideApproval(
  eventId: string,
  decision: "APPROVED" | "DECLINED",
): Promise<Approval> {
  return request<Approval>(`/api/approvals/${encodeURIComponent(eventId)}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}
