import pino from "pino";

import { config } from "../config.js";
import type { FeedItem, SweepState } from "../types.js";
import { getState, updateState } from "../state/store.js";
import { assertEventApproved } from "./approval-gate.js";
import { executeRailLeg, AppError } from "./sweep-client.js";
import { mintForConfirmation } from "./mint.js";

/**
 * The agent's money-touching orchestrator actions. Tools delegate here; these own the sweep state-machine
 * transitions and enforce the I-3 approval gate. `assertEventApproved` is the FIRST statement of each
 * guarded action — before any state mutation, loopback call, or chain write — so a pre-approval attempt
 * throws with state untouched (proven by scripts/gate-check.ts).
 */

const logger = pino({ name: "orchestrator-actions" });

const CANCEL_URL = `http://localhost:${config.PORT}/api/merchant/cancel`;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Mark a sweep FAILED and emit a feed ERROR item (code-standards §8 / I-8). */
function failSweep(event_id: string, at: SweepState, message: string): void {
  const now = new Date().toISOString();
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep) {
      sweep.state = "FAILED";
      sweep.failure = { at, message };
      sweep.timestamps.FAILED = now;
    }
    s.feed.push({
      id: `feed-error-${event_id}-${Date.now()}`,
      ts: now,
      kind: "ERROR",
      event_id,
      text: `Failed at ${at}: ${message}`,
    });
  });
}

/**
 * Tool `notify_user`: emit a plain-language note to the activity feed. The first notification for a freshly
 * RELEASED sweep also advances it to NOTIFIED (SYSTEM_DESIGN §5.2).
 */
export function notifyUser(event_id: string, message: string): void {
  const now = new Date().toISOString();
  updateState((s) => {
    s.feed.push({
      id: `feed-note-${event_id}-${Date.now()}`,
      ts: now,
      kind: "AGENT_NOTE",
      event_id,
      text: message,
    });
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep && sweep.state === "RELEASED") {
      sweep.state = "NOTIFIED";
      sweep.timestamps.NOTIFIED = now;
    }
  });
  logger.info({ event_id }, "notify_user");
}

/**
 * Tool `cancel_subscription`. I-3 GUARD then `→ CANCELLING`: cancels via the mock merchant endpoint over
 * loopback HTTP (~800ms), then `→ CANCELLED` recording CANCEL-88231. Requires APPROVED for event_id.
 */
export async function cancelSubscriptionForEvent(
  event_id: string,
  merchant: string,
): Promise<{ confirmation_id: string }> {
  assertEventApproved(event_id); // I-3 — throws before any mutation if not APPROVED

  const now = new Date().toISOString();
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep) {
      sweep.state = "CANCELLING";
      sweep.timestamps.CANCELLING = now;
    }
    s.feed.push({
      id: `feed-cancelling-${event_id}-${Date.now()}`,
      ts: now,
      kind: "STATE_CHANGE",
      event_id,
      text: `Cancelling subscription with ${merchant}…`,
    });
  });

  let confirmationId: string;
  try {
    const resp = await fetch(CANCEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant }),
    });
    if (!resp.ok) {
      throw new AppError("CANCEL_FAILED", `merchant cancel returned HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as { confirmation_id: string };
    confirmationId = body.confirmation_id;
  } catch (err) {
    const message = errMessage(err);
    failSweep(event_id, "CANCELLING", message);
    throw err instanceof AppError ? err : new AppError("CANCEL_FAILED", message);
  }

  const doneAt = new Date().toISOString();
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep) {
      sweep.state = "CANCELLED";
      sweep.cancel_confirmation_id = confirmationId;
      sweep.timestamps.CANCELLED = doneAt;
    }
    s.feed.push({
      id: `feed-cancelled-${event_id}-${Date.now()}`,
      ts: doneAt,
      kind: "STATE_CHANGE",
      event_id,
      text: `Subscription cancelled. Confirmation ${confirmationId}.`,
      ref: { label: "Cancel Confirmation", value: confirmationId },
    });
  });
  logger.info({ event_id, state: "CANCELLED" }, "cancel_subscription complete");
  return { confirmation_id: confirmationId };
}

/**
 * Tool `execute_sweep`. I-3 GUARD then `→ PAYMENT_REQUESTED`: runs the x402 rail leg (Unit 05) to VERIFIED,
 * then the on-chain mint (Unit 06) to MINTED. Requires APPROVED for event_id and a session beneficiary.
 *
 * ENH-4: Captures log-safe payment views during the rail negotiation and attaches them to sequential
 * feed items for collapsible terminal blocks in the activity feed.
 */
export async function executeSweepForEvent(
  event_id: string,
  amountMicro: bigint,
  memo: string,
  beneficiary: string | null,
): Promise<{ status: "MINTED"; confirmation_ref: string; shares_minted: string; tx_hash: string }> {
  assertEventApproved(event_id); // I-3 — throws before any mutation if not APPROVED
  if (!beneficiary) {
    throw new AppError(
      "NO_BENEFICIARY",
      `No session beneficiary for ${event_id}; call POST /api/demo/start first`,
    );
  }

  const now = new Date().toISOString();
  const payreqFeedId = `feed-payreq-${event_id}-${Date.now()}`;
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep) {
      sweep.state = "PAYMENT_REQUESTED";
      sweep.timestamps.PAYMENT_REQUESTED = now;
    }
    s.feed.push({
      id: payreqFeedId,
      ts: now,
      kind: "STATE_CHANGE",
      event_id,
      text: `Requesting x402 payment for ${memo}…`,
    });
  });

  try {
    const { confirmation_ref, views } = await executeRailLeg(amountMicro, memo, beneficiary); // → … → VERIFIED

    // ENH-4: Attach captured views and emit the signature card in the correct sequence.
    // The EIP-3009 authorization is signed *inside* executeRailLeg, BEFORE invest-route.ts pushes the
    // VERIFIED item — but we only receive the log-safe views after the call returns. So we INSERT the
    // signature card immediately before the VERIFIED item (and timestamp it just before VERIFIED) to
    // keep the feed narrative request → sign → verify.
    updateState((s) => {
      const payreqItem = s.feed.find((f) => f.id === payreqFeedId);
      if (payreqItem) {
        payreqItem.payment_views = { requirements: views.requirements };
      }

      // Attach the payment response view to the existing VERIFIED feed item (created by invest-route.ts).
      const verifiedIdx = s.feed.findIndex(
        (f) => f.event_id === event_id && f.text.startsWith("Sweep payment verified"),
      );
      const verifiedItem = verifiedIdx >= 0 ? s.feed[verifiedIdx] : undefined;
      if (verifiedItem) {
        verifiedItem.payment_views = { response: views.response };
      }

      const sigTs = verifiedItem
        ? new Date(Date.parse(verifiedItem.ts) - 1).toISOString()
        : new Date().toISOString();
      const signatureItem: FeedItem = {
        id: `feed-signed-${event_id}-${Date.now()}`,
        ts: sigTs,
        kind: "STATE_CHANGE",
        event_id,
        text: `Signing EIP-3009 authorization & submitting payment signature…`,
        payment_views: { authorization: views.authorization },
      };
      if (verifiedIdx >= 0) {
        s.feed.splice(verifiedIdx, 0, signatureItem);
      } else {
        s.feed.push(signatureItem);
      }
    });

    const { txHash, sharesMinted } = await mintForConfirmation(
      beneficiary,
      amountMicro,
      confirmation_ref,
      memo,
    ); // → MINTED
    return { status: "MINTED", confirmation_ref, shares_minted: sharesMinted, tx_hash: txHash };
  } catch (err) {
    const message = errMessage(err);
    const sweep = getState().sweeps.find((sw) => sw.event_id === event_id);
    const at = sweep?.state ?? "PAYMENT_REQUESTED";

    if (at === "VERIFIED") {
      logger.error({ event_id, error: message }, "x402 payment verified but minting encountered error; maintaining VERIFIED state");
      updateState((s) => {
        s.feed.push({
          id: `feed-mint-warning-${event_id}-${Date.now()}`,
          ts: new Date().toISOString(),
          kind: "ERROR",
          event_id,
          text: `Payment verified (${sweep?.confirmation_ref ?? "confirmed"}), but on-chain share minting experienced RPC delay: ${message}`,
        });
      });
      throw err instanceof AppError ? err : new AppError("MINT_DELAYED", message);
    }

    failSweep(event_id, at, message);
    throw err instanceof AppError ? err : new AppError("SWEEP_FAILED", message);
  }
}
