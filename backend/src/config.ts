import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // OQ1/V8 resolved p4-t1 (2026-06-22): cheapest function-calling model in OpenAI's official catalog
  // (developers.openai.com/api/docs/pricing — gpt-5.4-nano, $0.20/$1.25 per 1M). Override in .env if desired.
  AGENT_MODEL: z.string().default("gpt-5.4-nano"),
  OPENAI_API_KEY: z.string(),
  CIRCLE_API_KEY: z.string(),
  CIRCLE_ENTITY_SECRET: z.string(),
  CIRCLE_WALLET_ID: z.string(),
  SELLER_ADDRESS: z.string(),
  BUYER_PRIVATE_KEY: z.string().optional(),
  ARC_RPC_URL: z.string().default("https://rpc.testnet.arc.network"),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  ARC_EXPLORER_BASE: z.string().default("https://testnet.arcscan.app"),
  USDC_ADDRESS: z.string().default("0x3600000000000000000000000000000000000000"),
  GATEWAY_WALLET_ADDRESS: z.string().default("0x0077777d7EBA4688BDeF3E311b846F25870A19B9"),
  PENNYVAULT_ADDRESS: z.string().default("0x14603Ff851e01E23B769226786b4F68AE97EC268"), // Arc testnet, deployed 2026-06-21
  MQQQ_ADDRESS: z.string().default("0xFcbc4740026896ae7DF4F019cDbcbf66FBc1914b"), // Arc testnet, deployed 2026-06-21
  OPERATOR_PRIVATE_KEY: z.string().default("0x0000000000000000000000000000000000000000000000000000000000000000"), // Placeholder
  GATEWAY_FUND_TARGET_USDC: z.coerce.number().default(150),
  EVENT_B_TRIGGER_DELAY_MS: z.coerce.number().default(3000),
  SETTLEMENT_POLL_MS: z.coerce.number().default(30000),
  // x402 sweep authorization validity window (seconds), published as `maxTimeoutSeconds` and used for
  // the buyer's `validBefore`. Default 604900 = Circle Gateway batching floor (7d+100s, verified against
  // @circle-fin/x402-batching@3.2.0). Human-approved 2026-06-22; p3-t2 may empirically lower it (e.g. 36000=10h).
  SWEEP_AUTH_VALIDITY_SECONDS: z.coerce.number().int().positive().default(604900),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  PORT: z.coerce.number().default(3000)
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
};

export const config = parseEnv();
