import pino from "pino";
import { createPublicClient, http, formatUnits, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { config } from "../config.js";
import { getOrCreateAgentWallet } from "../payments/circle-client.js";
import { getGatewayBalanceMicro } from "../payments/gateway.js";
import { getState, updateState } from "./store.js";

const logger = pino({ name: "portfolio-refresh" });

const mqqqAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const pennyVaultAbi = [
  {
    name: "totalSweptUsdc",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

let cachedAgentAddress: Address | null = null;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL),
});

/**
 * Resolves the Agent Wallet address, caching it to avoid hitting Circle API limits.
 */
export async function getAgentAddress(): Promise<Address> {
  if (cachedAgentAddress) return cachedAgentAddress;
  const { wallet } = await getOrCreateAgentWallet();
  cachedAgentAddress = wallet.address as Address;
  return cachedAgentAddress;
}

/**
 * Refreshes all portfolio metrics by querying the blockchain and Circle APIs.
 */
export async function refreshPortfolio(): Promise<void> {
  const state = getState();
  const beneficiary = state.portfolio.beneficiary as Address | null;

  try {
    const agentAddress = await getAgentAddress();
    
    // 1. Fetch Gateway balance for the agent wallet (off-chain API read)
    let gatewayBalanceMicro = 0n;
    try {
      gatewayBalanceMicro = await getGatewayBalanceMicro(agentAddress);
    } catch (err: any) {
      logger.warn({ error: err.message }, "failed to fetch gateway balance micro");
    }

    // 2. Fetch on-chain balances for the beneficiary if active
    let mqqqBalance = 0n;
    let totalSwept = 0n;

    if (beneficiary) {
      try {
        const [bal, swept] = await Promise.all([
          publicClient.readContract({
            address: config.MQQQ_ADDRESS as Address,
            abi: mqqqAbi,
            functionName: "balanceOf",
            args: [beneficiary],
          }),
          publicClient.readContract({
            address: config.PENNYVAULT_ADDRESS as Address,
            abi: pennyVaultAbi,
            functionName: "totalSweptUsdc",
            args: [beneficiary],
          }),
        ]);
        mqqqBalance = bal;
        totalSwept = swept;
      } catch (err: any) {
        logger.warn({ error: err.message }, "failed to fetch contract balances");
      }
    }

    // 3. Update the global state projection
    updateState((s) => {
      s.portfolio.gateway_balance_usdc = formatUnits(gatewayBalanceMicro, 6);
      s.portfolio.mqqq_balance = formatUnits(mqqqBalance, 18);
      s.portfolio.total_swept_usdc = formatUnits(totalSwept, 6);
      s.portfolio.links = {
        beneficiary: beneficiary ? `${config.ARC_EXPLORER_BASE}/address/${beneficiary}` : "",
        mqqq_token: `${config.ARC_EXPLORER_BASE}/token/${config.MQQQ_ADDRESS}`,
        vault: `${config.ARC_EXPLORER_BASE}/address/${config.PENNYVAULT_ADDRESS}`,
        agent_wallet: `${config.ARC_EXPLORER_BASE}/address/${agentAddress}`,
        seller: `${config.ARC_EXPLORER_BASE}/address/${config.SELLER_ADDRESS}`,
      };
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "error in refreshPortfolio");
  }
}

let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Starts the periodic portfolio refresh background loop.
 */
export function startPortfolioPolling(intervalMs = 10000): void {
  if (pollingInterval) return;

  // Run initial refresh immediately
  refreshPortfolio().catch((err) => logger.error(err, "initial refreshPortfolio failed"));

  pollingInterval = setInterval(() => {
    refreshPortfolio().catch((err) => logger.error(err, "polling refreshPortfolio failed"));
  }, intervalMs);

  logger.info({ intervalMs }, "started portfolio polling loop");
}

/**
 * Stops the periodic portfolio refresh background loop.
 */
export function stopPortfolioPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info("stopped portfolio polling loop");
  }
}
