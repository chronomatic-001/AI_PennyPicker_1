import { randomBytes } from "node:crypto";

import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { getWalletById, signTypedData } from "./circle-client.js";

/**
 * x402 / Circle Gateway Nanopayments — buyer-side EIP-3009 signing.
 *
 * Shapes verified 2026-06-22 against Circle's reference impl `circlefin/arc-nanopayments`
 * (`lib/x402.ts`) and the published SDK `@circle-fin/x402-batching@3.2.0`
 * (`BatchEvmScheme.createPaymentPayload` / `signAuthorization`).
 *
 * Invariants:
 *  - I-1 rail purity: a `TransferWithAuthorization` bound to the `GatewayWalletBatched` domain
 *    (`extra.verifyingContract`), NOT a naked ERC-20 transfer and NOT the native USDC domain.
 *  - I-4 signing boundary: signed via the Circle Wallets API, never a raw private key.
 *  - I-5 exact amount + designated payee (`to` = `payTo`) + bounded validity window.
 *  - I-10: signature material is never logged. This module returns the signature; it never prints it.
 */

// Circle batching EIP-712 constants (from the SDK: CIRCLE_BATCHING_NAME / CIRCLE_BATCHING_VERSION).
const CIRCLE_BATCHING_NAME = "GatewayWalletBatched";
const CIRCLE_BATCHING_VERSION = "1";

// validAfter back-date for clock-skew tolerance (mirrors the SDK's `now - 600`).
const AUTH_BACKDATE_SECONDS = 600;

const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

/** x402 `exact`-scheme payment requirements (one entry of the 402 `accepts[]` array). */
export const paymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().regex(/^eip155:\d+$/, "network must be CAIP-2 eip155:<chainId>"),
  asset: z.string().refine(isAddress, "asset must be an EVM address"),
  amount: z.string().regex(/^\d+$/, "amount must be an integer micro-USDC string"),
  maxTimeoutSeconds: z.number().int().positive(),
  payTo: z.string().refine(isAddress, "payTo must be an EVM address"),
  extra: z.object({
    name: z.string(),
    version: z.string(),
    verifyingContract: z.string().refine(isAddress, "extra.verifyingContract must be an EVM address"),
  }),
});

export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

/** Full x402 v2 `PAYMENT-REQUIRED` envelope (base64-encoded into the header). */
export interface PaymentRequiredEnvelope {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
}

/** EIP-3009 authorization fields (string-encoded, as carried in the PaymentPayload). */
export interface SweepAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/** What the buyer base64-encodes into the `PAYMENT-SIGNATURE` header (Unit 05b submits it). */
export interface SignedPayment {
  x402Version: number;
  payload: { authorization: SweepAuthorization; signature: string };
}

export interface BuildAuthorizationOptions {
  /** The buyer (signer) address — the Circle agent wallet that holds the Gateway balance. */
  from: string;
  /** Override "now" (unix seconds) for deterministic tests. */
  now?: number;
  /** Override the random nonce for deterministic tests (0x + 64 hex). */
  nonce?: string;
  /** validAfter back-date in seconds (default 600). */
  backdateSeconds?: number;
}

export interface BuiltAuthorization {
  domain: Eip712Domain;
  authorization: SweepAuthorization;
  /** Full EIP-712 typed-data object passed (as JSON) to Circle Wallets `signTypedData`. */
  typedData: {
    domain: Eip712Domain;
    primaryType: "TransferWithAuthorization";
    types: {
      EIP712Domain: typeof EIP712_DOMAIN_TYPE;
      TransferWithAuthorization: typeof TRANSFER_WITH_AUTHORIZATION_TYPE;
    };
    message: SweepAuthorization;
  };
}

function randomNonce(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/**
 * Build the EIP-3009 `TransferWithAuthorization` typed data for a sweep — PURE, no network calls.
 * `value` is the exact micro-USDC amount; `to` is the seller `payTo`; the domain binds to
 * `extra.verifyingContract` (GatewayWalletBatched). `validBefore = now + maxTimeoutSeconds` keeps
 * the window driven entirely by the seller-published requirements (config `SWEEP_AUTH_VALIDITY_SECONDS`).
 */
export function buildSweepAuthorization(
  requirementsInput: unknown,
  opts: BuildAuthorizationOptions,
): BuiltAuthorization {
  const requirements = paymentRequirementsSchema.parse(requirementsInput);
  const chainId = Number.parseInt(requirements.network.split(":")[1] ?? "", 10);
  if (!Number.isInteger(chainId)) {
    throw new Error(`Unparseable chainId in network "${requirements.network}"`);
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const backdate = opts.backdateSeconds ?? AUTH_BACKDATE_SECONDS;
  const validAfter = (now - backdate).toString();
  const validBefore = (now + requirements.maxTimeoutSeconds).toString();
  const nonce = opts.nonce ?? randomNonce();

  if (requirements.extra.name !== CIRCLE_BATCHING_NAME || requirements.extra.version !== CIRCLE_BATCHING_VERSION) {
    throw new Error(
      `Refusing to sign: extra.name/version must be "${CIRCLE_BATCHING_NAME}"/"${CIRCLE_BATCHING_VERSION}" ` +
        `(got "${requirements.extra.name}"/"${requirements.extra.version}")`,
    );
  }

  const domain: Eip712Domain = {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId,
    verifyingContract: getAddress(requirements.extra.verifyingContract),
  };

  const authorization: SweepAuthorization = {
    from: getAddress(opts.from),
    to: getAddress(requirements.payTo),
    value: requirements.amount,
    validAfter,
    validBefore,
    nonce,
  };

  return {
    domain,
    authorization,
    typedData: {
      domain,
      primaryType: "TransferWithAuthorization",
      types: {
        EIP712Domain: EIP712_DOMAIN_TYPE,
        TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE,
      },
      message: { ...authorization },
    },
  };
}

/** Log-safe projection of an authorization — explicitly omits any signature material (I-10). */
export function inspectAuthorization(built: BuiltAuthorization): Record<string, unknown> {
  const { domain, authorization } = built;
  return {
    domain,
    from: authorization.from,
    to: authorization.to,
    value_micro: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    window_seconds: Number(authorization.validBefore) - Number(authorization.validAfter),
    nonce: authorization.nonce,
  };
}

export interface SignSweepOptions {
  /** Circle wallet id of the signer; defaults to env CIRCLE_WALLET_ID. */
  walletId?: string;
  /** Signer address; resolved from the wallet when omitted. */
  from?: string;
}

/**
 * Sign a sweep authorization via the Circle Wallets API (I-4). Returns the `SignedPayment`
 * the merchant submits to Nanopayments (Unit 05b). The raw signature is returned but NEVER logged.
 */
export async function signSweepAuthorization(
  requirementsInput: unknown,
  opts: SignSweepOptions = {},
): Promise<SignedPayment> {
  const walletId = opts.walletId ?? process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("CIRCLE_WALLET_ID is required to sign a sweep authorization");
  }
  const from = opts.from ?? (await getWalletById(walletId)).address;
  const built = buildSweepAuthorization(requirementsInput, { from });

  const signature = await signTypedData({
    walletId,
    data: JSON.stringify(built.typedData),
    memo: `AI PennyPicker sweep authorization ${built.authorization.value} micro-USDC to ${built.authorization.to}`,
  });

  if (!signature.startsWith("0x") || signature.length < 132) {
    throw new Error("Circle signTypedData returned a signature in an unexpected format");
  }

  return {
    x402Version: 2,
    payload: { authorization: built.authorization, signature },
  };
}
