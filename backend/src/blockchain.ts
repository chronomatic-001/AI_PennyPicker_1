import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { config } from "./config.js";

/**
 * Centralized Public Client for Arc Testnet EVM RPC calls.
 * Configured with batching and retry logic to prevent rate-limit crashes (HTTP 429).
 */
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL, {
    batch: true,
    retryCount: 5,
    retryDelay: 1000,
  }),
});

/**
 * Centralized Wallet Client for operator on-chain actions (settleAndMint, recordSettlement).
 */
export const account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as Address);

export const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL, {
    batch: true,
    retryCount: 5,
    retryDelay: 1000,
  }),
});
