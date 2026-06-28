import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { SavingsEvent } from "./types.js";

/**
 * The two predefined savings-event fixtures (BLUEPRINT §3.1), loaded read-only from backend/fixtures.
 * Single source of truth for both the agent tools (get_pending_events) and the orchestrator (event release).
 */
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

function loadFixture(file: string): SavingsEvent {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")) as SavingsEvent;
}

export const EVENT_FIXTURES: Record<string, SavingsEvent> = {
  "EVT-A-001": loadFixture("event_a_coffee_coupon.json"),
  "EVT-B-001": loadFixture("event_b_subscription_leak.json"),
};

/** The fixed two-event demo order: A releases on Start, B auto-releases when A reaches a terminal state. */
export const EVENT_ORDER = ["EVT-A-001", "EVT-B-001"] as const;
