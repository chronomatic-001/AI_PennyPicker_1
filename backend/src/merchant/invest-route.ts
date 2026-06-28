import { Router, type Request, type Response } from "express";
import pino from "pino";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import { microToUsdc } from "../payments/gateway.js";
import type { PaymentRequirements, PaymentRequiredEnvelope } from "../payments/eip3009.js";
import { submitAndVerifyPayment } from "../payments/nanopayments.js";
import { updateState } from "../state/store.js";
import { derivePaymentRef } from "../orchestrator/mint.js";

/**
 * `POST /api/invest` — the x402-protected merchant endpoint (SYSTEM_DESIGN §3.5).
 *
 * p3-t1 (Unit 05a) implements the no-payment branch only: it answers a payment-less request with
 * `402 Payment Required` carrying the x402 v2 requirements in a base64 `PAYMENT-REQUIRED` header
 * (envelope shape verified against Circle's `lib/x402.ts`). The payment-attached branch
 * (verify + settle via the Nanopayments BatchFacilitatorClient) is added in p3-t2 (Unit 05b).
 */

const logger = pino({ name: "invest-route" });

const investBodySchema = z.object({
  // Decimal USDC string, ≤6 dp (e.g. "2.150000"); converted to exact micro-USDC for the requirements.
  amount_usdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "amount_usdc must be a USDC decimal with <=6 dp"),
  beneficiary: z.string().refine(isAddress, "beneficiary must be an EVM address"),
  memo: z.string().min(1),
});

/** Parse a ≤6-dp decimal USDC string into exact integer micro-USDC (no float math). */
export function parseUsdcToMicro(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  const fracMicro = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracMicro || "0");
}

/** Build the x402 `exact`-scheme requirements for a sweep of `amountMicro`. */
export function buildInvestRequirements(amountMicro: bigint): PaymentRequirements {
  return {
    scheme: "exact",
    network: `eip155:${config.ARC_CHAIN_ID}`,
    asset: getAddress(config.USDC_ADDRESS),
    amount: amountMicro.toString(),
    maxTimeoutSeconds: config.SWEEP_AUTH_VALIDITY_SECONDS,
    payTo: getAddress(config.SELLER_ADDRESS),
    // `extra.verifyingContract` = GatewayWalletBatched domain (distinct from `payTo`). I-1/I-5.
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: getAddress(config.GATEWAY_WALLET_ADDRESS),
    },
  };
}

/** Wrap the requirements in the x402 v2 envelope (`{ x402Version, resource, accepts:[...] }`). */
export function buildPaymentRequiredEnvelope(
  amountMicro: bigint,
  resourceUrl = "/api/invest",
): PaymentRequiredEnvelope {
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: `AI PennyPicker investment sweep (${microToUsdc(amountMicro)} USDC)`,
      mimeType: "application/json",
    },
    accepts: [buildInvestRequirements(amountMicro)],
  };
}

/** Base64-encode the envelope for the `PAYMENT-REQUIRED` response header. */
export function encodePaymentRequiredHeader(envelope: PaymentRequiredEnvelope): string {
  return Buffer.from(JSON.stringify(envelope)).toString("base64");
}

export const investRouter = Router();

investRouter.post("/", async (req: Request, res: Response) => {
  const parsed = investBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid invest request", issues: parsed.error.issues });
  }

  const amountMicro = parseUsdcToMicro(parsed.data.amount_usdc);
  const paymentSignature = req.header("PAYMENT-SIGNATURE");

  if (!paymentSignature) {
    const envelope = buildPaymentRequiredEnvelope(amountMicro);
    res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(envelope));
    logger.info(
      { amount_usdc: parsed.data.amount_usdc, beneficiary: parsed.data.beneficiary, memo: parsed.data.memo },
      "issued 402 PAYMENT-REQUIRED",
    );
    return res.status(402).json({});
  }

  // Payment-attached branch — verify + settle via Nanopayments.
  // Never log the PAYMENT-SIGNATURE contents (I-10).
  logger.info({ amount_usdc: parsed.data.amount_usdc }, "payment-attached /api/invest received; invoking submitAndVerifyPayment");

  try {
    const signedPayment = JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf-8"));
    if (!signedPayment || !signedPayment.payload || !signedPayment.payload.authorization || !signedPayment.payload.signature) {
      return res.status(400).json({ error: "invalid PAYMENT-SIGNATURE structure" });
    }

    const verificationResult = await submitAndVerifyPayment(signedPayment, amountMicro);

    if (verificationResult.status === "VERIFIED" && verificationResult.confirmation_ref) {
      const confirmationRef = verificationResult.confirmation_ref;
      const paymentRef = derivePaymentRef(confirmationRef);
      const eventId = parsed.data.memo.split(" ")[0] || "EVT-UNKNOWN";
      const now = new Date().toISOString();

      updateState((s) => {
        let sweep = s.sweeps.find((sw) => sw.event_id === eventId);
        if (!sweep) {
          sweep = {
            event_id: eventId,
            state: "VERIFIED",
            amount_usdc: parseFloat(parsed.data.amount_usdc),
            memo: parsed.data.memo,
            timestamps: {},
          };
          s.sweeps.push(sweep);
        } else {
          sweep.state = "VERIFIED";
        }
        sweep.confirmation_ref = confirmationRef;
        sweep.payment_ref = paymentRef;
        sweep.timestamps.VERIFIED = now;

        s.feed.push({
          id: `feed-verified-${eventId}-${Date.now()}`,
          ts: now,
          kind: "STATE_CHANGE",
          event_id: eventId,
          text: `Sweep payment verified: ${parsed.data.amount_usdc} USDC. Confirmation: ${confirmationRef}`,
          ref: {
            label: "Confirmation Ref",
            value: confirmationRef,
          },
        });
      });

      res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ status: "VERIFIED", confirmation_ref: confirmationRef })).toString("base64"));
      return res.status(200).json({
        status: "VERIFIED",
        confirmation_ref: confirmationRef,
        amount_usdc: parsed.data.amount_usdc,
      });
    } else {
      return res.status(402).json({
        error: "payment verification failed",
        reason: verificationResult.errorReason || "Unknown verification failure",
      });
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "error parsing or processing PAYMENT-SIGNATURE");
    return res.status(400).json({ error: "malformed PAYMENT-SIGNATURE header", details: err.message });
  }
});
