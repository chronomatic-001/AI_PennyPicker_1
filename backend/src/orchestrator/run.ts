import pino from "pino";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { config } from "../config.js";
import type { DemoState } from "../types.js";
import { getState, updateState } from "../state/store.js";
import { refreshPortfolio } from "../state/portfolio.js";
import { EVENT_FIXTURES } from "../fixtures.js";
import { runAgentForEvent } from "../agent/loop.js";
import { AppError } from "./sweep-client.js";

/**
 * Demo orchestration (SYSTEM_DESIGN §5.2/§5.3). Event chaining lives HERE, not in the agent: A releases on
 * Start, and B auto-releases EVENT_B_TRIGGER_DELAY_MS after A reaches any terminal state (MINTED/DECLINED/FAILED)
 * — so decline and failure still chain and the demo never dead-ends. The phase goes COMPLETE once B terminates.
 */

const logger = pino({ name: "orchestrator-run" });

const EVENT_MEMOS: Record<string, string> = {
  "EVT-A-001": "EVT-A-001 coffee coupon delta",
  "EVT-B-001": "EVT-B-001 subscription leak",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Release an event into the demo: create its RELEASED sweep and emit the rich EVENT_CARD feed item (I-8). */
function releaseEvent(event_id: string): void {
  const fixture = EVENT_FIXTURES[event_id];
  if (!fixture) throw new AppError("UNKNOWN_EVENT", `No fixture for ${event_id}`);
  const now = new Date().toISOString();
  updateState((s) => {
    if (s.sweeps.some((sw) => sw.event_id === event_id)) return; // idempotent release
    s.sweeps.push({
      event_id,
      state: "RELEASED",
      amount_usdc: fixture.savings_usd,
      memo: EVENT_MEMOS[event_id] ?? `${event_id} sweep`,
      timestamps: { RELEASED: now },
    });
    s.feed.push({
      id: `feed-event-${event_id}-${Date.now()}`,
      ts: now,
      kind: "EVENT_CARD",
      event_id,
      text: `Found $${fixture.savings_usd.toFixed(2)} — ${fixture.narrative} (${fixture.merchant}).`,
    });
  });
  logger.info({ event_id, state: "RELEASED" }, "event released");
}

/** Background A→B chain. Always ends with phase COMPLETE, even if an event declines or fails. */
async function runEventChain(): Promise<void> {
  try {
    await runAgentForEvent("EVT-A-001");
    await delay(config.EVENT_B_TRIGGER_DELAY_MS);
    releaseEvent("EVT-B-001");
    await runAgentForEvent("EVT-B-001");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "event chain error");
  } finally {
    const now = new Date().toISOString();
    updateState((s) => {
      s.phase = "COMPLETE";
      s.feed.push({
        id: `feed-complete-${Date.now()}`,
        ts: now,
        kind: "STATE_CHANGE",
        text: "Demo complete.",
      });
    });
    logger.info({ phase: "COMPLETE" }, "demo complete");
  }
}

/**
 * `POST /api/demo/start` logic. Validates IDLE (caller maps the thrown AppError to 409), generates the session's
 * ephemeral receive-only beneficiary (private key derived then discarded — it never signs and is never funded),
 * releases Event A, kicks off the background chain, and returns the current state immediately.
 */
export function startDemo(): DemoState {
  if (getState().phase !== "IDLE") {
    throw new AppError("DEMO_NOT_IDLE", `Cannot start demo: phase is ${getState().phase}, expected IDLE`);
  }

  const beneficiary = privateKeyToAccount(generatePrivateKey()).address; // key discarded immediately
  const now = new Date().toISOString();
  updateState((s) => {
    s.phase = "RUNNING";
    s.portfolio.beneficiary = beneficiary;
    s.feed.push({
      id: `feed-start-${Date.now()}`,
      ts: now,
      kind: "STATE_CHANGE",
      text: `Demo started. Generated this session's portfolio address — the beneficiary that holds the mQQQ minted this run.`,
      ref: {
        label: "Portfolio Address",
        value: beneficiary,
        href: `${config.ARC_EXPLORER_BASE}/address/${beneficiary}`,
      },
    });
  });
  logger.info({ beneficiary, phase: "RUNNING" }, "demo started");

  releaseEvent("EVT-A-001");
  refreshPortfolio().catch((err) =>
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "portfolio refresh after start failed"),
  );

  void runEventChain();
  return getState();
}
