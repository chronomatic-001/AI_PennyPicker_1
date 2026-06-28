import { createRequire } from "module";
const require = createRequire(import.meta.url);
const dcwPkg = require("@circle-fin/developer-controlled-wallets");

const initiateDeveloperControlledWalletsClient = dcwPkg.initiateDeveloperControlledWalletsClient as typeof import("@circle-fin/developer-controlled-wallets").initiateDeveloperControlledWalletsClient;

import type {
  Balance,
  Blockchain,
  CircleDeveloperControlledWalletsClient,
  SignTypedDataInput,
  Wallet,
  WalletWithBalances,
} from "@circle-fin/developer-controlled-wallets";
import { isAddress } from "viem";
import { z } from "zod";

export const ARC_TESTNET_CHAIN = "ARC-TESTNET" as Blockchain;
export const AGENT_WALLET_NAME = "AI PennyPicker Agent Wallet";
export const AGENT_WALLET_REF_ID = "ai-pennypicker-agent-wallet";
export const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

const WALLET_SET_NAME = "AI PennyPicker Wallet Set";
const WALLET_SET_IDEMPOTENCY_KEY = "f2a42a31-8a35-4e26-bd82-2aebf7a0f102";
const WALLET_IDEMPOTENCY_KEY = "7c14dc9d-1f4f-4389-9550-c75d2b97f203";

const circleEnvSchema = z.object({
  CIRCLE_API_KEY: z.string().min(1, "CIRCLE_API_KEY is required"),
  CIRCLE_ENTITY_SECRET: z.string().min(1, "CIRCLE_ENTITY_SECRET is required"),
  CIRCLE_WALLET_ID: z.string().optional(),
});

export type CircleEnv = z.infer<typeof circleEnvSchema>;

export interface AgentWalletResult {
  wallet: Wallet;
  source: "env" | "existing" | "created";
}

export function loadCircleEnv(env = process.env): CircleEnv {
  const result = circleEnvSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing Circle environment variables: ${missing}`);
  }
  return result.data;
}

export function createCircleClient(
  env: CircleEnv = loadCircleEnv(),
): CircleDeveloperControlledWalletsClient {
  return initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
}

export async function getWalletById(
  walletId: string,
  client = createCircleClient(),
): Promise<Wallet> {
  const response = await client.getWallet({ id: walletId });
  const wallet = response.data?.wallet;
  if (!wallet) {
    throw new Error(`Circle wallet ${walletId} was not returned by the Wallets API`);
  }
  return wallet;
}

export async function getOrCreateAgentWallet(
  client = createCircleClient(),
  env = loadCircleEnv(),
): Promise<AgentWalletResult> {
  if (env.CIRCLE_WALLET_ID) {
    return { wallet: await getWalletById(env.CIRCLE_WALLET_ID, client), source: "env" };
  }

  const existing = await findExistingAgentWallet(client);
  if (existing) {
    return { wallet: existing, source: "existing" };
  }

  const walletSetResponse = await client.createWalletSet({
    name: WALLET_SET_NAME,
    idempotencyKey: WALLET_SET_IDEMPOTENCY_KEY,
  });
  const walletSetId = walletSetResponse.data?.walletSet?.id;
  if (!walletSetId) {
    throw new Error("Circle wallet-set creation returned no walletSet id");
  }

  const walletResponse = await client.createWallets({
    walletSetId,
    blockchains: [ARC_TESTNET_CHAIN],
    count: 1,
    accountType: "EOA",
    idempotencyKey: WALLET_IDEMPOTENCY_KEY,
    metadata: [{ name: AGENT_WALLET_NAME, refId: AGENT_WALLET_REF_ID }],
  });
  const wallet = walletResponse.data?.wallets?.find((item) => item.blockchain === ARC_TESTNET_CHAIN);
  if (!wallet) {
    throw new Error("Circle wallet creation returned no Arc Testnet wallet");
  }
  return { wallet, source: "created" };
}

export async function getWalletsWithBalances(
  address: string,
  client = createCircleClient(),
): Promise<WalletWithBalances[]> {
  if (!isAddress(address)) {
    throw new Error(`Invalid wallet address: ${address}`);
  }

  const response = await client.getWalletsWithBalances({
    address,
    blockchain: ARC_TESTNET_CHAIN,
    pageSize: 20,
  });
  return response.data?.wallets ?? [];
}

export async function signTypedData(
  input: SignTypedDataInput,
  client = createCircleClient(),
): Promise<string> {
  const response = await client.signTypedData(input);
  const signature = response.data?.signature;
  if (!signature) {
    throw new Error("Circle signTypedData returned no signature");
  }
  return signature;
}

export function addressExplorerUrl(address: string): string {
  return `${process.env.ARC_EXPLORER_BASE ?? ARC_EXPLORER_BASE}/address/${address}`;
}

export function describeCircleBalances(balances: Balance[]): string[] {
  return balances.map((balance) => {
    const token = balance.token;
    const symbol = token.symbol ?? token.name ?? token.id ?? "token";
    const decimals = token.decimals ?? "unknown";
    const tokenAddress = token.tokenAddress || "native";
    return `${symbol} amount=${balance.amount} decimals=${decimals} token=${tokenAddress}`;
  });
}

async function findExistingAgentWallet(
  client: CircleDeveloperControlledWalletsClient,
): Promise<Wallet | null> {
  const response = await client.listWallets({
    blockchain: ARC_TESTNET_CHAIN,
    refId: AGENT_WALLET_REF_ID,
    pageSize: 20,
  });
  return response.data?.wallets?.[0] ?? null;
}
