import pino from "pino";
import { config } from "../src/config.js";
import { getState, updateState, resetState } from "../src/state/store.js";
import { refreshPortfolio } from "../src/state/portfolio.js";

const logger = pino({ name: "state-test" });

async function runTests() {
  logger.info("Starting State Store & Portfolio Polling Tests...");

  // 1. Verify in-process pristine state
  const state1 = getState();
  if (state1.phase !== "IDLE" || state1.portfolio.beneficiary !== null) {
    throw new Error("Initial state is not pristine IDLE");
  }
  logger.info("Initial pristine state is valid.");

  // 2. Set a dummy beneficiary address to test on-chain reading
  const dummyBeneficiary = "0x535567b819f20e408ec20ee5d9d7f6c382345678";
  logger.info({ dummyBeneficiary }, "Simulating beneficiary setting in store...");
  updateState((s) => {
    s.portfolio.beneficiary = dummyBeneficiary;
  });

  // 3. Trigger manual portfolio refresh
  logger.info("Refreshing portfolio metrics...");
  await refreshPortfolio();

  const state2 = getState();
  logger.info({
    gateway_balance: state2.portfolio.gateway_balance_usdc,
    mqqq_balance: state2.portfolio.mqqq_balance,
    total_swept: state2.portfolio.total_swept_usdc,
    links: state2.portfolio.links
  }, "Refreshed portfolio projection");

  // Assertions
  if (state2.portfolio.links.beneficiary !== `${config.ARC_EXPLORER_BASE}/address/${dummyBeneficiary}`) {
    throw new Error("Beneficiary explorer link is incorrect");
  }
  if (state2.portfolio.links.mqqq_token !== `${config.ARC_EXPLORER_BASE}/token/${config.MQQQ_ADDRESS}`) {
    throw new Error("mQQQ token explorer link is incorrect");
  }
  if (state2.portfolio.links.vault !== `${config.ARC_EXPLORER_BASE}/address/${config.PENNYVAULT_ADDRESS}`) {
    throw new Error("Vault explorer link is incorrect");
  }
  if (parseFloat(state2.portfolio.gateway_balance_usdc) < 0) {
    throw new Error("Invalid gateway balance fetched");
  }
  logger.info("✅ In-process portfolio refresh and formatting tests passed.");

  // 4. Test reset
  logger.info("Resetting store...");
  resetState();
  const state3 = getState();
  if (state3.portfolio.beneficiary !== null || parseFloat(state3.portfolio.mqqq_balance) !== 0) {
    throw new Error("Reset did not clear beneficiary or balances");
  }
  logger.info("✅ Reset state test passed.");

  // 5. Test HTTP endpoints against running server
  const serverUrl = `http://localhost:${config.PORT}`;
  logger.info({ serverUrl }, "Testing REST API endpoints on running server...");
  try {
    const resState = await fetch(`${serverUrl}/api/state`);
    if (!resState.ok) throw new Error(`/api/state returned HTTP ${resState.status}`);
    const bodyState: any = await resState.json();
    if (bodyState.phase !== "IDLE") {
      throw new Error(`Running server phase is ${bodyState.phase}, expected IDLE`);
    }
    logger.info("✅ GET /api/state returned valid pristine state.");

    const resReset = await fetch(`${serverUrl}/api/demo/reset`, { method: "POST" });
    if (!resReset.ok) throw new Error(`/api/demo/reset returned HTTP ${resReset.status}`);
    const bodyReset: any = await resReset.json();
    if (bodyReset.phase !== "IDLE") {
      throw new Error(`Reset route response phase is ${bodyReset.phase}, expected IDLE`);
    }
    logger.info("✅ POST /api/demo/reset returned successfully.");
  } catch (err: any) {
    logger.error({ error: err.message }, "HTTP verification failed. Ensure server is running on port 3000.");
    process.exit(1);
  }

  logger.info("🎉 All State Store and Portfolio Refresh tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  logger.error({ error: err.message }, "Test failed with exception");
  process.exit(1);
});
