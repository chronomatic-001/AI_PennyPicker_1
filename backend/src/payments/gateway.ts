import { randomUUID } from "node:crypto";

import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { z } from "zod";
import pino from "pino";

import { createCircleClient, loadCircleEnv, type CircleEnv } from "./circle-client.js";

const logger = pino({ name: "gateway-client" });

// Arc testnet constants (verified Unit 02/04 against docs.arc.io + developers.circle.com/gateway).
export const USDC_ADDRESS = (process.env.USDC_ADDRESS ??
  "0x3600000000000000000000000000000000000000") as Address;
export const GATEWAY_WALLET_ADDRESS = (process.env.GATEWAY_WALLET_ADDRESS ??
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as Address;
export const ARC_GATEWAY_DOMAIN = 26;
export const GATEWAY_API_BASE = process.env.GATEWAY_API_BASE ?? "https://gateway-api-testnet.circle.com";

// Circle developer-controlled-wallets transaction states (from the installed SDK).
const SUCCESS_STATES = new Set(["CONFIRMED", "COMPLETE"]);
const FAILURE_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

// POST /v1/balances response shape (developers.circle.com/gateway EVM quickstart).
const balancesResponseSchema = z.object({
  balances: z.array(z.object({ domain: z.number(), balance: z.string() })),
});

/** Format integer micro-USDC (6 dp) for display only — never feed back into math. */
export function microToUsdc(micro: bigint): string {
  const negative = micro < 0n;
  const value = negative ? -micro : micro;
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Whole/2-dp USDC number → integer micro-USDC bigint. */
export function usdcToMicro(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1_000_000));
}

function decimalUsdcToMicro(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  const fracMicro = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracMicro || "0");
}

/** Raw (un-deposited) ERC-20 USDC balance of an address, in micro-USDC (6 dp). */
export async function getRawUsdcMicro(address: Address): Promise<bigint> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"),
  });
  return client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

/** Finalized unified Gateway balance for a depositor on Arc (domain 26), in micro-USDC. */
export async function getGatewayBalanceMicro(
  depositor: Address,
  env: CircleEnv = loadCircleEnv(),
): Promise<bigint> {
  let attempt = 0;
  const maxAttempts = 3;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const response = await fetch(`${GATEWAY_API_BASE}/v1/balances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.CIRCLE_API_KEY}`,
        },
        body: JSON.stringify({
          token: "USDC",
          sources: [{ domain: ARC_GATEWAY_DOMAIN, depositor }],
        }),
      });
      if (!response.ok) {
        throw new Error(`Gateway balances API returned ${response.status} ${response.statusText}`);
      }
      const parsed = balancesResponseSchema.parse(await response.json());
      const arc = parsed.balances.find((entry) => entry.domain === ARC_GATEWAY_DOMAIN) ?? parsed.balances[0];
      return arc ? decimalUsdcToMicro(arc.balance) : 0n;
    } catch (error: any) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      logger.warn({ attempt, error: error.message }, "retrying Gateway balance query after failure");
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return 0n; // unreachable
}

export interface GatewayDepositResult {
  approveTxHash: string;
  depositTxHash: string;
}

/**
 * One-time Gateway funding: ERC-20 approve(GatewayWallet, amount) then GatewayWallet.deposit(USDC, amount),
 * BOTH signed via the Circle Wallets API from the developer-controlled agent wallet (invariant I-4 — no raw keys).
 * The depositor identity equals the payment-signer identity (Gateway balances are spendable only by the
 * depositor's signatures; the Unit 02 signing probe PASSED for this wallet, OQ7).
 */
export async function depositToGateway(
  amountMicro: bigint,
  walletId: string,
  client: CircleDeveloperControlledWalletsClient = createCircleClient(),
): Promise<GatewayDepositResult> {
  const amount = amountMicro.toString();
  const fee = { type: "level", config: { feeLevel: "MEDIUM" } } as const;

  const approve = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [GATEWAY_WALLET_ADDRESS, amount],
    fee,
    idempotencyKey: randomUUID(),
  });
  const approveTxHash = await waitForTransaction(approve.data?.id, client, "approve");

  const deposit = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: GATEWAY_WALLET_ADDRESS,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [USDC_ADDRESS, amount],
    fee,
    idempotencyKey: randomUUID(),
  });
  const depositTxHash = await waitForTransaction(deposit.data?.id, client, "deposit");

  return { approveTxHash, depositTxHash };
}

/** Poll a Circle transaction until it reaches a terminal state; return its on-chain hash. */
async function waitForTransaction(
  id: string | undefined,
  client: CircleDeveloperControlledWalletsClient,
  label: string,
  timeoutMs = 180_000,
): Promise<string> {
  if (!id) {
    throw new Error(`${label}: Circle returned no transaction id`);
  }
  const start = Date.now();
  for (;;) {
    const response = await client.getTransaction({ id });
    const tx = response.data?.transaction;
    const state = tx?.state ?? "UNKNOWN";
    if (SUCCESS_STATES.has(state)) {
      return tx?.txHash ?? "";
    }
    if (FAILURE_STATES.has(state)) {
      throw new Error(`${label} transaction ${id} ended in state ${state}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label} transaction ${id} not confirmed within ${timeoutMs}ms (last state ${state})`);
    }
    await sleep(4000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
