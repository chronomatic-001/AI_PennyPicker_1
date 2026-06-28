import "dotenv/config";

import { isAddress, type Address } from "viem";

import {
  addressExplorerUrl,
  createCircleClient,
  getWalletById,
  loadCircleEnv,
  type CircleEnv,
} from "../circle-client.js";
import {
  depositToGateway,
  getGatewayBalanceMicro,
  getRawUsdcMicro,
  microToUsdc,
  usdcToMicro,
} from "../gateway.js";

// Keep >= $5 raw USDC outside Gateway as the §10.1 fallback's liquidity (feature spec 04).
const RESERVE_MICRO = 5_000_000n;

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const env = loadCircleEnv();
  if (!env.CIRCLE_WALLET_ID) {
    throw new Error("Set CIRCLE_WALLET_ID in backend/.env (run npm run circle:create-wallet first)");
  }
  const client = createCircleClient(env);

  const wallet = await getWalletById(env.CIRCLE_WALLET_ID, client);
  const address = wallet.address as Address;
  if (!isAddress(address)) {
    throw new Error(`Circle wallet returned an invalid address: ${address}`);
  }

  const targetMicro = usdcToMicro(Number(process.env.GATEWAY_FUND_TARGET_USDC ?? "150"));

  const rawMicro = await getRawUsdcMicro(address);
  let gatewayMicro = 0n;
  let gatewayReadError: string | null = null;
  try {
    gatewayMicro = await getGatewayBalanceMicro(address, env);
  } catch (error) {
    gatewayReadError = error instanceof Error ? error.message : String(error);
  }

  const shortfall = targetMicro - gatewayMicro;
  const rawAvailable = rawMicro - RESERVE_MICRO;
  const depositMicro = shortfall <= rawAvailable ? shortfall : rawAvailable;

  process.stdout.write(
    [
      "Gateway deposit plan (depositor = agent spender wallet = payment signer, OQ7 PASS)",
      `  wallet           = ${address}`,
      `  explorer         = ${addressExplorerUrl(address)}`,
      `  raw USDC (6dp)   = ${microToUsdc(rawMicro)}`,
      `  Gateway balance  = ${gatewayReadError ? `UNREADABLE (${gatewayReadError}); assuming 0 for planning` : microToUsdc(gatewayMicro)}`,
      `  target           = ${microToUsdc(targetMicro)}`,
      `  reserve (keep)   = ${microToUsdc(RESERVE_MICRO)}`,
      `  shortfall        = ${microToUsdc(shortfall < 0n ? 0n : shortfall)}`,
      `  raw available    = ${microToUsdc(rawAvailable < 0n ? 0n : rawAvailable)}`,
      `  -> would deposit = ${microToUsdc(depositMicro < 0n ? 0n : depositMicro)}`,
    ].join("\n") + "\n",
  );

  if (shortfall <= 0n) {
    process.stdout.write("Already funded to target. Nothing to deposit.\n");
    return;
  }
  if (rawAvailable <= 0n) {
    throw new Error(
      `Insufficient raw USDC to deposit while keeping the ${microToUsdc(RESERVE_MICRO)} USDC reserve. ` +
        `Keep accumulating from faucet.circle.com (Arc Testnet) to ${address} and re-run.`,
    );
  }

  if (!execute) {
    process.stdout.write(
      "\nPLAN ONLY — no on-chain action taken. Re-run with `--execute` to approve + deposit (human-confirmed).\n",
    );
    return;
  }

  process.stdout.write(
    `\nExecuting approve + deposit of ${microToUsdc(depositMicro)} USDC via Circle Wallets (signs from the agent wallet)...\n`,
  );
  const { approveTxHash, depositTxHash } = await depositToGateway(depositMicro, env.CIRCLE_WALLET_ID, client);
  process.stdout.write(
    [
      `approve tx = ${approveTxHash || "(pending)"}  ${txExplorerUrl(approveTxHash)}`,
      `deposit tx = ${depositTxHash || "(pending)"}  ${txExplorerUrl(depositTxHash)}`,
      "Polling Gateway balance until the deposit reaches finality (can take minutes)...",
    ].join("\n") + "\n",
  );
  const finalMicro = await pollGatewayBalance(address, env, gatewayMicro);
  process.stdout.write(
    `Final Gateway balance = ${microToUsdc(finalMicro)} USDC (raw reserve retained: >= ${microToUsdc(RESERVE_MICRO)}).\n`,
  );
}

function txExplorerUrl(hash: string): string {
  const base = process.env.ARC_EXPLORER_BASE ?? "https://testnet.arcscan.app";
  return hash ? `${base}/tx/${hash}` : "(hash pending)";
}

async function pollGatewayBalance(
  address: Address,
  env: CircleEnv,
  before: bigint,
  timeoutMs = 1_500_000,
): Promise<bigint> {
  const start = Date.now();
  for (;;) {
    const balance = await getGatewayBalanceMicro(address, env);
    if (balance > before || Date.now() - start > timeoutMs) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fund failed: ${message}\n`);
  process.exit(1);
});
