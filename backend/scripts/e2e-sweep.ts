import { createPublicClient, http, formatUnits, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import pino from "pino";
import { config } from "../src/config.js";
import { getOrCreateAgentWallet } from "../src/payments/circle-client.js";
import { getGatewayBalanceMicro, microToUsdc } from "../src/payments/gateway.js";
import { executeRailLeg, AppError } from "../src/orchestrator/sweep-client.js";
import { mintForConfirmation } from "../src/orchestrator/mint.js";

const logger = pino({ name: "e2e-sweep" });

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL),
});

const mqqqAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// A dummy beneficiary address for the sweep recipient (needs to be a valid EVM address)
const DUMMY_BENEFICIARY = "0x535567b819f20e408ec20ee5d9d7f6c382345678" as Address;

async function runE2eSweep() {
  logger.info("Starting E2E Nanopayments Sweep Test ($0.10)...");

  // 1. Resolve agent wallet address
  logger.info("Resolving agent wallet EOA address...");
  const { wallet } = await getOrCreateAgentWallet();
  const agentAddress = wallet.address as Address;
  logger.info({ agentAddress }, "resolved agent wallet");

  // 2. Read initial Gateway balance
  logger.info("Checking initial Gateway balance...");
  const balanceBefore = await getGatewayBalanceMicro(agentAddress);
  logger.info({ balance_before: microToUsdc(balanceBefore) }, "Initial Gateway balance");

  if (balanceBefore < 100_000n) {
    logger.error("Insufficient Gateway balance to perform $0.10 sweep. Run npm run gateway:fund first.");
    process.exit(1);
  }

  // 3. Execute the $0.10 rail leg (100,000 micro-USDC)
  logger.info("Executing $0.10 sweep rail leg...");
  const result = await executeRailLeg(100_000n, "EVT-A-001 e2e sweep test", DUMMY_BENEFICIARY);
  logger.info({ confirmation_ref: result.confirmation_ref }, "Sweep rail leg VERIFIED successfully!");

  // 3.5. Execute on-chain settleAndMint
  logger.info("Checking initial mQQQ balance for beneficiary...");
  const mqqqBalanceBefore = await publicClient.readContract({
    address: config.MQQQ_ADDRESS as Address,
    abi: mqqqAbi,
    functionName: "balanceOf",
    args: [DUMMY_BENEFICIARY],
  });
  logger.info({ balance_before: formatUnits(mqqqBalanceBefore, 18) }, "Initial mQQQ balance");

  logger.info("Executing on-chain settleAndMint via mintForConfirmation...");
  const mintResult = await mintForConfirmation(
    DUMMY_BENEFICIARY,
    100_000n,
    result.confirmation_ref,
    "EVT-A-001 e2e sweep test",
  );
  logger.info(mintResult, "Mint result");

  logger.info("Checking final mQQQ balance for beneficiary...");
  const mqqqBalanceAfter = await publicClient.readContract({
    address: config.MQQQ_ADDRESS as Address,
    abi: mqqqAbi,
    functionName: "balanceOf",
    args: [DUMMY_BENEFICIARY],
  });
  logger.info({ balance_after: formatUnits(mqqqBalanceAfter, 18) }, "Final mQQQ balance");

  const expectedShares = (100_000n * 10n ** 18n) / 500_000_000n; // 2e14 = 0.0002 mQQQ
  const actualShares = mqqqBalanceAfter - mqqqBalanceBefore;
  logger.info({ expected_shares: formatUnits(expectedShares, 18), actual_shares: formatUnits(actualShares, 18) }, "Verifying mQQQ shares minted");

  if (actualShares !== expectedShares) {
    logger.error(`mQQQ balance delta mismatch: expected ${expectedShares.toString()}, got ${actualShares.toString()}`);
    process.exit(1);
  }
  logger.info("✅ First mint succeeded and exact shares verified!");

  // 3.6. Run duplicate/replay test
  logger.info("Executing duplicate replay test: calling mintForConfirmation again...");
  const replayResult = await mintForConfirmation(
    DUMMY_BENEFICIARY,
    100_000n,
    result.confirmation_ref,
    "EVT-A-001 e2e sweep test",
  );
  logger.info(replayResult, "Replay mint result (expected recovery, no new mint)");

  logger.info("Checking final-final mQQQ balance for beneficiary...");
  const mqqqBalanceFinal = await publicClient.readContract({
    address: config.MQQQ_ADDRESS as Address,
    abi: mqqqAbi,
    functionName: "balanceOf",
    args: [DUMMY_BENEFICIARY],
  });

  if (mqqqBalanceFinal !== mqqqBalanceAfter) {
    logger.error(`Replay test failed: extra mQQQ minted! Before: ${mqqqBalanceAfter.toString()}, After: ${mqqqBalanceFinal.toString()}`);
    process.exit(1);
  }
  logger.info("✅ Replay protection verified (no duplicate mint)!");

  // 4. Verify Gateway balance decreased by exactly $0.10
  logger.info("Checking final Gateway balance...");
  const balanceAfter = await getGatewayBalanceMicro(agentAddress);
  logger.info({ balance_after: microToUsdc(balanceAfter) }, "Final Gateway balance");

  const delta = balanceBefore - balanceAfter;
  logger.info({ expected_delta: "0.100000", actual_delta: microToUsdc(delta) }, "Verifying balance delta");

  if (delta !== 100_000n) {
    logger.error(`Balance delta mismatch: expected 100000 micro-USDC, got ${delta.toString()}`);
    process.exit(1);
  }

  logger.info("✅ Positive E2E sweep test passed!");

  // 5. Negative test: tampered/expired signature
  logger.info("Running negative test with tampered signature...");
  const targetUrl = `http://localhost:${config.PORT}/api/invest`;
  
  // Send invalid signature format
  const badSignatureBase64 = Buffer.from(JSON.stringify({
    x402Version: 2,
    payload: {
      authorization: {
        from: agentAddress,
        to: config.SELLER_ADDRESS,
        value: "100000",
        validAfter: "0",
        validBefore: "0", // Expired/invalid validity window
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      signature: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" // Invalid signature
    }
  })).toString("base64");

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": badSignatureBase64,
      },
      body: JSON.stringify({
        amount_usdc: "0.100000",
        beneficiary: DUMMY_BENEFICIARY,
        memo: "tampered sweep test",
      }),
    });

    if (response.status === 200) {
      logger.error("❌ Negative test failed: Server accepted invalid/tampered signature!");
      process.exit(1);
    }

    const body: any = await response.json();
    logger.info({ status: response.status, body }, "Negative test successfully rejected by server");
    logger.info("✅ Negative test passed!");

  } catch (error: any) {
    logger.error({ error: error.message }, "Negative test request threw exception");
    process.exit(1);
  }

  logger.info("🎉 All E2E Nanopayments Sweep Tests passed!");
  process.exit(0);
}

runE2eSweep().catch((error) => {
  logger.error({ error: error.message }, "E2E sweep test failed with exception");
  process.exit(1);
});
