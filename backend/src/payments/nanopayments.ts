import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import pino from "pino";
import { config } from "../config.js";
import { buildInvestRequirements } from "../merchant/invest-route.js";
import type { SignedPayment } from "./eip3009.js";
import { GATEWAY_API_BASE, microToUsdc } from "./gateway.js";

const logger = pino({ name: "nanopayments" });

export interface NanopaymentsVerificationResult {
  status: "VERIFIED" | "FAILED";
  confirmation_ref?: string;
  errorReason?: string;
}

// Initialize the BatchFacilitatorClient pointing to the Gateway Testnet API
export const facilitator = new BatchFacilitatorClient({
  url: GATEWAY_API_BASE,
  createAuthHeaders: async () => {
    const headers = {
      Authorization: `Bearer ${config.CIRCLE_API_KEY}`,
      "Content-Type": "application/json",
    };
    return {
      verify: headers,
      settle: headers,
      supported: headers,
    };
  },
});

/**
 * Submit a signed payment to Circle Gateway for verification and settlement (batching).
 *
 * Implements:
 * 1. Building the expected requirements for the payment.
 * 2. Creating the PaymentPayload shape.
 * 3. Calling facilitator.verify.
 * 4. Calling facilitator.settle if verified.
 *
 * Invariant I-10: Raw signature material or keys are NEVER logged.
 */
export async function submitAndVerifyPayment(
  signedPayment: SignedPayment,
  amountMicro: bigint,
): Promise<NanopaymentsVerificationResult> {
  const expectedRequirements = buildInvestRequirements(amountMicro);

  const paymentPayload = {
    x402Version: signedPayment.x402Version,
    resource: {
      url: "/api/invest",
      description: `AI PennyPicker investment sweep (${microToUsdc(amountMicro)} USDC)`,
      mimeType: "application/json",
    },
    accepted: expectedRequirements,
    payload: signedPayment.payload,
  };

  try {
    logger.info(
      { amount_usdc: microToUsdc(amountMicro), payer: signedPayment.payload.authorization.from },
      "performing verify step via Circle BatchFacilitatorClient",
    );

    const verifyResult = await facilitator.verify(paymentPayload, expectedRequirements);

    if (!verifyResult.isValid) {
      logger.warn(
        { reason: verifyResult.invalidReason },
        "payment verification failed",
      );
      return {
        status: "FAILED",
        errorReason: verifyResult.invalidReason || "Verification failed without explicit reason",
      };
    }

    logger.info(
      { payer: verifyResult.payer },
      "payment verification succeeded, proceeding to settle",
    );

    const settleResult = await facilitator.settle(paymentPayload, expectedRequirements);

    if (!settleResult.success) {
      logger.error(
        { reason: settleResult.errorReason },
        "payment settlement failed",
      );
      return {
        status: "FAILED",
        errorReason: settleResult.errorReason || "Settlement failed without explicit reason",
      };
    }

    logger.info(
      { confirmation_ref: settleResult.transaction },
      "payment settlement accepted by Circle Gateway",
    );

    return {
      status: "VERIFIED",
      confirmation_ref: settleResult.transaction,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, "exception during nanopayments submit/verify");
    return {
      status: "FAILED",
      errorReason: error.message || "Unknown exception occurred",
    };
  }
}
