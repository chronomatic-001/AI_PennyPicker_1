import pino from "pino";

import { resetState, getState, updateState } from "../src/state/store.js";
import { createAgentTools } from "../src/agent/tools.js";
import { assertEventApproved } from "../src/orchestrator/approval-gate.js";
import type { Approval, Sweep, SweepState } from "../src/types.js";

/**
 * gate-check.ts (p4-t1) — proves the I-3 approval gate blocks money movement BEFORE an APPROVED decision.
 *
 * For an event whose approval is PENDING or DECLINED, execute_sweep and cancel_subscription must throw, and
 * the DemoState must be byte-identical before and after (nothing moved). A positive control confirms the
 * guard passes once APPROVED. No network or chain calls happen: the guard throws first.
 */

const logger = pino({ name: "gate-check" });

interface Check {
  label: string;
  pass: boolean;
}
const checks: Check[] = [];

function seedSweep(event_id: string, decision: Approval["decision"], state: SweepState, amount: number): void {
  updateState((s) => {
    const approval: Approval = { event_id, proposal: `Invest $${amount.toFixed(2)} from ${event_id}?`, decision };
    const sweep: Sweep = {
      event_id,
      state,
      amount_usdc: amount,
      memo: `${event_id} gate-check seed`,
      approval,
      timestamps: {},
    };
    s.sweeps.push(sweep);
  });
}

async function expectThrowUnchanged(label: string, fn: () => Promise<unknown>): Promise<void> {
  const before = JSON.stringify(getState());
  let threw = false;
  let detail = "";
  try {
    await fn();
  } catch (err) {
    threw = true;
    detail = err instanceof Error ? err.message : String(err);
  }
  const unchanged = JSON.stringify(getState()) === before;
  const pass = threw && unchanged;
  checks.push({ label, pass });
  logger.info({ label, threw, unchanged, detail: threw ? detail : undefined }, pass ? "PASS" : "FAIL");
}

function expectGuard(label: string, event_id: string, shouldThrow: boolean): void {
  let threw = false;
  try {
    assertEventApproved(event_id);
  } catch {
    threw = true;
  }
  const pass = threw === shouldThrow;
  checks.push({ label, pass });
  logger.info({ label, threw }, pass ? "PASS" : "FAIL");
}

async function run(): Promise<void> {
  logger.info("Gate-check: I-3 approval gate must block execute_sweep / cancel_subscription before APPROVED.");

  // 1. execute_sweep with a PENDING approval must throw; state unchanged.
  resetState();
  seedSweep("EVT-A-001", "PENDING", "AWAITING_APPROVAL", 2.15);
  await expectThrowUnchanged("execute_sweep blocked when approval PENDING", () =>
    createAgentTools({ event_id: "EVT-A-001", beneficiary: null }).execute_sweep({
      amount_usdc: "2.150000",
      memo: "EVT-A-001 coffee coupon delta",
    }),
  );

  // 2. execute_sweep with a DECLINED approval must throw; state unchanged.
  resetState();
  seedSweep("EVT-A-001", "DECLINED", "DECLINED", 2.15);
  await expectThrowUnchanged("execute_sweep blocked when approval DECLINED", () =>
    createAgentTools({ event_id: "EVT-A-001", beneficiary: null }).execute_sweep({
      amount_usdc: "2.150000",
      memo: "EVT-A-001 coffee coupon delta",
    }),
  );

  // 3. cancel_subscription with a PENDING approval must throw; state unchanged.
  resetState();
  seedSweep("EVT-B-001", "PENDING", "AWAITING_APPROVAL", 9.5);
  await expectThrowUnchanged("cancel_subscription blocked when approval PENDING", () =>
    createAgentTools({ event_id: "EVT-B-001", beneficiary: null }).cancel_subscription({
      merchant: "PixelGame Subscription",
    }),
  );

  // 4. Positive control: the guard passes once APPROVED.
  resetState();
  seedSweep("EVT-A-001", "APPROVED", "APPROVED", 2.15);
  expectGuard("guard passes when approval APPROVED", "EVT-A-001", false);

  // 5. The guard throws for an unknown event.
  resetState();
  expectGuard("guard throws for unknown event", "EVT-UNKNOWN", true);

  const passed = checks.filter((c) => c.pass).length;
  const allPass = passed === checks.length;
  logger.info({ total: checks.length, passed }, allPass ? "ALL GATE CHECKS PASSED" : "GATE CHECK FAILURES");
  process.exit(allPass ? 0 : 1);
}

run().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, "gate-check crashed");
  process.exit(1);
});
