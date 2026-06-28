import pino from "pino";
import { config } from "../config.js";
import { signSweepAuthorization } from "../payments/eip3009.js";
import { microToUsdc } from "../payments/gateway.js";
import type { PaymentRequirementsView, AuthorizationView, PaymentResponseView } from "../types.js";

const logger = pino({ name: "sweep-client" });

export class AppError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = "AppError";
  }
}

interface InvestResponse {
  status: string;
  confirmation_ref: string;
  amount_usdc: string;
}

/**
 * Middle-truncate a hex signature for safe display. Full signature never leaves this module.
 * Example: "0x56a94922deadbeef...a4931b" (first 10 + last 8 chars).
 * Security: I-10 — raw signature material is never logged or stored in DemoState.
 */
export function truncateSignature(sig: string): string {
  if (sig.length <= 22) return sig;
  return `${sig.slice(0, 10)}…${sig.slice(-8)}`;
}

/** Log-safe views captured during the x402 rail negotiation. */
export interface RailLegViews {
  requirements: PaymentRequirementsView;
  authorization: AuthorizationView;
  response: PaymentResponseView;
}

/**
 * Execute the primary x402 payment rail leg:
 * 1. Call POST /api/invest without payment -> receive 402 challenge.
 * 2. Parse the base64-encoded PAYMENT-REQUIRED header.
 * 3. Sign the sweep authorization via payments/eip3009.ts using Circle Developer Controlled Wallets.
 * 4. Retry the POST /api/invest with the signed EIP-3009 authorization in the PAYMENT-SIGNATURE header.
 * 5. Return the payment confirmation reference + log-safe views for the activity feed.
 *
 * Invariant I-5: Exact amount, designated payee, and bounded validity window.
 * Invariant I-10: Raw signature material is never logged. Only truncated forms enter DemoState.
 */
export async function executeRailLeg(
  amountMicro: bigint,
  memo: string,
  beneficiary: string,
): Promise<{ confirmation_ref: string; views: RailLegViews }> {
  const amountUsdcStr = microToUsdc(amountMicro);
  const targetUrl = `http://localhost:${config.PORT}/api/invest`;

  logger.info(
    { targetUrl, amount_usdc: amountUsdcStr, beneficiary, memo },
    "initiating x402 sweep payment leg",
  );

  // --- Step 1: Initial call with no payment attached ---
  let initialResponse: Response;
  try {
    initialResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount_usdc: amountUsdcStr,
        beneficiary,
        memo,
      }),
    });
  } catch (error: any) {
    throw new AppError(
      "CONNECTION_FAILED",
      `Failed to connect to local API: ${error.message}`,
      error,
    );
  }

  // Expect 402 Payment Required
  if (initialResponse.status !== 402) {
    const text = await initialResponse.text();
    throw new AppError(
      "UNEXPECTED_RESPONSE",
      `Expected 402 status from initial call, got ${initialResponse.status}`,
      { body: text },
    );
  }

  // --- Step 2: Parse x402 requirements from the PAYMENT-REQUIRED header ---
  const paymentRequiredHeader = initialResponse.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    throw new AppError(
      "MISSING_CHALLENGE",
      "Initial response was 402 but lacked the PAYMENT-REQUIRED header",
    );
  }

  let envelope: any;
  try {
    const decoded = Buffer.from(paymentRequiredHeader, "base64").toString("utf-8");
    envelope = JSON.parse(decoded);
  } catch (error: any) {
    throw new AppError(
      "MALFORMED_CHALLENGE",
      `Failed to parse PAYMENT-REQUIRED header: ${error.message}`,
    );
  }

  const requirements = envelope.accepts?.[0];
  if (!requirements) {
    throw new AppError(
      "INVALID_CHALLENGE",
      "No valid requirements found in the accepts block of x402 envelope",
    );
  }

  // Capture the x402 requirements view (log-safe — no secret material)
  const requirementsView: PaymentRequirementsView = {
    scheme: requirements.scheme ?? "exact",
    network: requirements.network ?? "",
    asset: requirements.asset ?? "",
    amount: requirements.amount ?? "",
    payTo: requirements.payTo ?? "",
    verifyingContract: requirements.extra?.verifyingContract ?? "",
  };

  logger.info("received valid x402 challenge, initiating EIP-3009 signing via Circle Wallets API");

  // --- Step 3: Sign the authorization (EIP-3009) via Circle Wallets ---
  let signedPayment: any;
  try {
    // eip3009.ts is configured to sign via the wallet referenced by configuration
    signedPayment = await signSweepAuthorization(requirements);
  } catch (error: any) {
    throw new AppError(
      "SIGNING_FAILED",
      `Failed to sign sweep authorization: ${error.message}`,
      error,
    );
  }

  // Capture the EIP-3009 authorization view with TRUNCATED signature (I-10)
  const authorizationView: AuthorizationView = {
    from: signedPayment.payload?.authorization?.from ?? "",
    to: signedPayment.payload?.authorization?.to ?? "",
    value: signedPayment.payload?.authorization?.value ?? "",
    nonce: signedPayment.payload?.authorization?.nonce ?? "",
    signature_truncated: truncateSignature(signedPayment.payload?.signature ?? ""),
  };

  logger.info("signature generated successfully, retrying request with PAYMENT-SIGNATURE");

  // --- Step 4: Retry the request with the signature attached ---
  const signatureBase64 = Buffer.from(JSON.stringify(signedPayment)).toString("base64");

  let retryResponse: Response;
  try {
    retryResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": signatureBase64,
      },
      body: JSON.stringify({
        amount_usdc: amountUsdcStr,
        beneficiary,
        memo,
      }),
    });
  } catch (error: any) {
    throw new AppError(
      "RETRY_CONNECTION_FAILED",
      `Failed to connect to local API on retry: ${error.message}`,
      error,
    );
  }

  if (retryResponse.status !== 200) {
    let details: any = {};
    try {
      details = await retryResponse.json();
    } catch {
      try {
        details = { text: await retryResponse.text() };
      } catch {}
    }
    throw new AppError(
      "PAYMENT_REJECTED",
      `Payment retry returned status ${retryResponse.status}`,
      details,
    );
  }

  const responseBody: InvestResponse = await retryResponse.json();
  if (responseBody.status !== "VERIFIED" || !responseBody.confirmation_ref) {
    throw new AppError(
      "INVALID_CONFIRMATION",
      `Response status was 200 but settlement was not VERIFIED: ${JSON.stringify(responseBody)}`,
    );
  }

  // Capture the payment response view (log-safe)
  const responseView: PaymentResponseView = {
    status: responseBody.status,
    confirmation_ref: responseBody.confirmation_ref,
  };

  logger.info(
    { confirmation_ref: responseBody.confirmation_ref },
    "x402 rail leg completed successfully to VERIFIED",
  );

  return {
    confirmation_ref: responseBody.confirmation_ref,
    views: {
      requirements: requirementsView,
      authorization: authorizationView,
      response: responseView,
    },
  };
}
