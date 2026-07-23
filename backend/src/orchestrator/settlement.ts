import pino from "pino";
import {
  formatUnits,
  keccak256,
  stringToHex,
  type Address,
} from "viem";
import { config } from "../config.js";
import { getState, updateState } from "../state/store.js";
import { publicClient, walletClient, account } from "../blockchain.js";

const logger = pino({ name: "settlement-orchestrator" });

const gatewayAbi = [
  {
    name: "availableBalance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const pennyVaultAbi = [
  {
    name: "recordSettlement",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "usdcAmount", type: "uint256" },
      { name: "batchRef", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "totalConfirmedUsdc",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalSettledUsdc",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Executes a single check-and-settle true-up cycle.
 */
export async function executeSettlementTrueUp(): Promise<void> {
  try {
    const seller = config.SELLER_ADDRESS as Address;
    const gateway = config.GATEWAY_WALLET_ADDRESS as Address;
    const usdc = config.USDC_ADDRESS as Address;
    const vault = config.PENNYVAULT_ADDRESS as Address;

    logger.debug({ seller }, "checking seller available balance and vault total settled usdc");

    // 1. Query Gateway available balance of the seller & PennyVault totalSettledUsdc on-chain
    const [availableBalance, totalSettledUsdc, totalConfirmedUsdc] = await Promise.all([
      publicClient.readContract({
        address: gateway,
        abi: gatewayAbi,
        functionName: "availableBalance",
        args: [usdc, seller],
      }),
      publicClient.readContract({
        address: vault,
        abi: pennyVaultAbi,
        functionName: "totalSettledUsdc",
      }),
      publicClient.readContract({
        address: vault,
        abi: pennyVaultAbi,
        functionName: "totalConfirmedUsdc",
      }),
    ]);

    logger.debug(
      {
        available: formatUnits(availableBalance, 6),
        settledOnChain: formatUnits(totalSettledUsdc, 6),
        confirmedOnChain: formatUnits(totalConfirmedUsdc, 6),
      },
      "retrieved true-up parameters",
    );

    // Update base ledger numbers in store
    updateState((s) => {
      s.settlement.total_confirmed_usdc = formatUnits(totalConfirmedUsdc, 6);
      s.settlement.total_settled_usdc = formatUnits(totalSettledUsdc, 6);
    });

    // 2. Reconcile differences: if available > totalSettled, a batch has landed
    if (availableBalance > totalSettledUsdc) {
      const amountMicro = availableBalance - totalSettledUsdc;
      const batchRef = keccak256(stringToHex(`batch-${availableBalance.toString()}`));

      logger.info(
        { amount_usdc: formatUnits(amountMicro, 6), batchRef },
        "true-up difference detected; recording settlement on-chain",
      );

      const { request } = await publicClient.simulateContract({
        address: vault,
        abi: pennyVaultAbi,
        functionName: "recordSettlement",
        args: [amountMicro, batchRef],
        account,
      });

      const hash = await walletClient.writeContract(request);
      logger.info({ txHash: hash }, "submitted recordSettlement transaction, waiting for receipt");

      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 4_000 });
      logger.info({ txHash: hash, blockNumber: receipt.blockNumber }, "recordSettlement transaction confirmed");

      // Refetch stats and update state
      const [newSettled, newConfirmed] = await Promise.all([
        publicClient.readContract({ address: vault, abi: pennyVaultAbi, functionName: "totalSettledUsdc" }),
        publicClient.readContract({ address: vault, abi: pennyVaultAbi, functionName: "totalConfirmedUsdc" }),
      ]);

      updateState((s) => {
        s.settlement.total_confirmed_usdc = formatUnits(newConfirmed, 6);
        s.settlement.total_settled_usdc = formatUnits(newSettled, 6);
        s.settlement.records.push({
          batch_ref: batchRef,
          amount_usdc: formatUnits(amountMicro, 6),
          ts: new Date().toISOString(),
        });
      });

      logger.info("settlement true-up updated successfully in state store");
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "exception during settlement true-up execution");
  }
}

let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Starts the background true-up settlement polling loop.
 */
export function startSettlementPolling(intervalMs = 30000): void {
  if (pollingInterval) return;

  // Run initial check immediately
  executeSettlementTrueUp().catch((err) => logger.error(err, "initial settlement true-up failed"));

  pollingInterval = setInterval(() => {
    executeSettlementTrueUp().catch((err) => logger.error(err, "polling settlement true-up failed"));
  }, intervalMs);

  logger.info({ intervalMs }, "started settlement true-up polling loop");
}

/**
 * Stops the background true-up settlement polling loop.
 */
export function stopSettlementPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info("stopped settlement true-up polling loop");
  }
}
