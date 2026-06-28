import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  keccak256,
  stringToHex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { config } from "../config.js";
import { updateState } from "../state/store.js";
import { refreshPortfolio } from "../state/portfolio.js";

const logger = pino({ name: "mint-orchestrator" });

const pennyVaultAbi = [
  {
    name: "settleAndMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "beneficiary", type: "address" },
      { name: "usdcAmount", type: "uint256" },
      { name: "paymentRef", type: "bytes32" },
      { name: "memo", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "processedPayments",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "SweepConfirmed",
    type: "event",
    inputs: [
      { name: "beneficiary", type: "address", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "sharesMinted", type: "uint256", indexed: false },
      { name: "paymentRef", type: "bytes32", indexed: true },
      { name: "memo", type: "string", indexed: false },
    ],
    anonymous: false,
  },
] as const;

// In-memory processed paymentRef cache (First-line guard)
const processedLocalRefs = new Set<string>();

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL),
});

const account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as Address);
const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL),
});

/**
 * Derives a paymentRef from the Nanopayments confirmation reference.
 */
export function derivePaymentRef(confirmationRef: string): Address {
  return keccak256(stringToHex(confirmationRef));
}

/**
 * Execute the on-chain settleAndMint on the PennyVault.
 * Resolves V7 (idempotency).
 */
export async function mintForConfirmation(
  beneficiary: string,
  amountMicro: bigint,
  confirmationRef: string,
  memo: string,
): Promise<{ txHash: string; sharesMinted: string }> {
  const paymentRef = derivePaymentRef(confirmationRef);

  logger.info(
    { beneficiary, amount_usdc: formatUnits(amountMicro, 6), confirmationRef, paymentRef },
    "initiating settleAndMint on-chain",
  );

  let result: { txHash: string; sharesMinted: string } | null = null;

  // Guard 1: Check in-memory local cache
  if (processedLocalRefs.has(paymentRef)) {
    logger.info({ paymentRef }, "paymentRef found in local cache, performing idempotent recovery");
    result = await recoverMintDetails(paymentRef);
  } else {
    // Guard 2: Check on-chain processedPayments mapping (second-line guard)
    let isProcessed = false;
    try {
      isProcessed = await publicClient.readContract({
        address: config.PENNYVAULT_ADDRESS as Address,
        abi: pennyVaultAbi,
        functionName: "processedPayments",
        args: [paymentRef],
      });
    } catch (err: any) {
      logger.warn({ error: err.message }, "failed to read processedPayments mapping from contract");
    }

    if (isProcessed) {
      logger.info({ paymentRef }, "paymentRef found in contract processedPayments, performing idempotent recovery");
      processedLocalRefs.add(paymentRef);
      result = await recoverMintDetails(paymentRef);
    } else {
      // Execute on-chain settleAndMint
      try {
        const { request } = await publicClient.simulateContract({
          address: config.PENNYVAULT_ADDRESS as Address,
          abi: pennyVaultAbi,
          functionName: "settleAndMint",
          args: [beneficiary as Address, amountMicro, paymentRef, memo],
          account,
        });

        const hash = await walletClient.writeContract(request);
        logger.info({ txHash: hash }, "transaction submitted to mint shares, waiting for receipt");

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        logger.info({ txHash: hash, blockNumber: receipt.blockNumber }, "mint transaction confirmed");

        // Add to local cache
        processedLocalRefs.add(paymentRef);

        const expectedShares = (amountMicro * 10n ** 18n) / 500_000_000n;
        result = {
          txHash: hash,
          sharesMinted: formatUnits(expectedShares, 18),
        };
      } catch (error: any) {
        const errMsg = error.message || "";
        if (errMsg.includes("duplicate payment ref") || errMsg.includes("0x2b380f2d") || errMsg.includes("duplicate")) {
          logger.info({ paymentRef }, "revert observed due to duplicate payment ref, performing recovery");
          processedLocalRefs.add(paymentRef);
          result = await recoverMintDetails(paymentRef);
        } else {
          logger.error({ error: errMsg }, "settleAndMint failed");
          throw error;
        }
      }
    }
  }

  // Update state store with the result of minting
  if (result) {
    const { txHash, sharesMinted } = result;
    const now = new Date().toISOString();

    updateState((s) => {
      let sweep = s.sweeps.find((sw) => sw.confirmation_ref === confirmationRef);
      if (!sweep) {
        const eventId = memo.split(" ")[0] || "EVT-UNKNOWN";
        sweep = s.sweeps.find((sw) => sw.event_id === eventId);
      }

      if (sweep) {
        if (sweep.state === "MINTED") {
          // Already in MINTED state, avoid duplicate feed logs
          return;
        }
        sweep.state = "MINTED";
        sweep.shares_minted = sharesMinted;
        sweep.mint_tx_hash = txHash;
        sweep.timestamps.MINTED = now;
      }

      const eventId = memo.split(" ")[0] || "EVT-UNKNOWN";
      s.feed.push({
        id: `feed-minted-${eventId}-${Date.now()}`,
        ts: now,
        kind: "RECEIPT",
        event_id: eventId,
        text: `Shares minted: ${sharesMinted} mQQQ. Tx Hash: ${txHash}`,
        ref: {
          label: "View Mint Tx",
          value: txHash,
          href: `${config.ARC_EXPLORER_BASE}/tx/${txHash}`,
        },
      });
    });

    // Trigger portfolio refresh to update balances
    refreshPortfolio().catch((err) => logger.error({ error: err.message }, "failed to refresh portfolio after mint"));
  }

  return result;
}

/**
 * Searches the chain events to retrieve transaction hash and shares minted for a paymentRef.
 */
async function recoverMintDetails(
  paymentRef: string,
): Promise<{ txHash: string; sharesMinted: string }> {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock > 5000n ? currentBlock - 5000n : 0n;

    // Query SweepConfirmed event logs
    const logs = await publicClient.getContractEvents({
      address: config.PENNYVAULT_ADDRESS as Address,
      abi: pennyVaultAbi,
      eventName: "SweepConfirmed",
      args: {
        paymentRef: paymentRef as Address,
      },
      fromBlock,
    });

    if (logs.length > 0) {
      const event = logs[0];
      if (event) {
        const shares = event.args.sharesMinted ?? 0n;
        const hash = event.transactionHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
        logger.info({ txHash: hash, sharesMinted: formatUnits(shares, 18) }, "idempotent recovery succeeded");
        return {
          txHash: hash,
          sharesMinted: formatUnits(shares, 18),
        };
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "failed to recover mint details from event logs");
  }

  // Fallback if event is not found or fails to fetch
  const defaultShares = 0n;
  return {
    txHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    sharesMinted: formatUnits(defaultShares, 18),
  };
}
