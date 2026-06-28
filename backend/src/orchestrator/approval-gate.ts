import pino from "pino";

import type { Approval } from "../types.js";
import { EVENT_FIXTURES } from "../fixtures.js";
import { getState, updateState } from "../state/store.js";
import { AppError } from "./sweep-client.js";

/**
 * The I-3 approval gate (ARCHITECTURE §2, invariant I-3) and the request/settle plumbing for the agent's
 * `request_approval` tool. The gate is enforced in backend code here — NOT in the agent prompt: no sweep or
 * subscription cancel proceeds without a recorded APPROVED decision for that specific event_id.
 */

const logger = pino({ name: "approval-gate" });

/** event_id -> resolver for the promise a parked `request_approval` call is awaiting. */
const pendingApprovalResolvers = new Map<string, (approval: Approval) => void>();

function formatDecisionEventLabel(event_id: string): string {
  const fixture = EVENT_FIXTURES[event_id];
  if (!fixture) return event_id;

  const amount = fixture.savings_usd.toFixed(2);
  const label =
    fixture.type === "COUPON_DELTA" ? "Coffee Savings" : "Subscription Leak";
  return `${event_id} ($${amount} ${label})`;
}

/**
 * I-3 GUARD. Throws unless the sweep for `event_id` carries a recorded APPROVED decision. Called as the first
 * statement of every money-moving orchestrator action (guards the `→ CANCELLING` and `→ PAYMENT_REQUESTED`
 * transitions) so a pre-approval attempt fails before any state mutation, network, or chain write.
 */
export function assertEventApproved(event_id: string): void {
  const sweep = getState().sweeps.find((sw) => sw.event_id === event_id);
  const decision = sweep?.approval?.decision;
  if (decision !== "APPROVED") {
    throw new AppError(
      "APPROVAL_REQUIRED",
      `I-3 approval gate: event ${event_id} is not APPROVED (decision=${decision ?? "none"})`,
    );
  }
}

/**
 * Tool `request_approval`: park the agent until the human decides. Transitions the sweep to AWAITING_APPROVAL,
 * sets `pending_approval`, emits an APPROVAL_REQUEST feed item (I-8), and returns a promise the approval
 * endpoint (POST /api/approvals/:event_id, wired in p4-t2) settles via settleApproval.
 */
export function requestApproval(event_id: string, proposal: string): Promise<Approval> {
  const now = new Date().toISOString();
  updateState((s) => {
    const approval: Approval = { event_id, proposal, decision: "PENDING" };
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep) {
      sweep.approval = approval;
      sweep.state = "AWAITING_APPROVAL";
      sweep.timestamps.AWAITING_APPROVAL = now;
    }
    s.pending_approval = approval;
    s.feed.push({
      id: `feed-approq-${event_id}-${Date.now()}`,
      ts: now,
      kind: "APPROVAL_REQUEST",
      event_id,
      text: proposal,
    });
  });
  logger.info({ event_id, state: "AWAITING_APPROVAL" }, "approval requested; agent parked");
  return new Promise<Approval>((resolve) => {
    pendingApprovalResolvers.set(event_id, resolve);
  });
}

/**
 * Settle a pending approval. Records the decision, transitions the sweep to APPROVED or DECLINED, emits an
 * APPROVAL_DECISION feed item, clears `pending_approval`, and resolves the parked request_approval promise.
 */
export function settleApproval(event_id: string, decision: "APPROVED" | "DECLINED"): Approval {
  const current = getState().sweeps.find((sw) => sw.event_id === event_id);
  if (!current?.approval || current.approval.decision !== "PENDING") {
    throw new AppError("NO_PENDING_APPROVAL", `No pending approval to settle for event ${event_id}`);
  }

  const now = new Date().toISOString();
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep?.approval) {
      sweep.approval.decision = decision;
      sweep.approval.decided_at = now;
      sweep.state = decision === "APPROVED" ? "APPROVED" : "DECLINED";
      sweep.timestamps[sweep.state] = now;
    }
    s.pending_approval = null;
    s.feed.push({
      id: `feed-apdec-${event_id}-${Date.now()}`,
      ts: now,
      kind: "APPROVAL_DECISION",
      event_id,
      text: `User ${decision === "APPROVED" ? "approved" : "declined"} the proposal for ${formatDecisionEventLabel(event_id)}.`,
    });
  });

  const settled = getState().sweeps.find((sw) => sw.event_id === event_id)?.approval;
  if (!settled) {
    throw new AppError("APPROVAL_SETTLE_FAILED", `Approval for ${event_id} vanished during settle`);
  }

  const resolver = pendingApprovalResolvers.get(event_id);
  if (resolver) {
    pendingApprovalResolvers.delete(event_id);
    resolver(settled);
  }
  logger.info({ event_id, decision }, "approval settled");
  return settled;
}
