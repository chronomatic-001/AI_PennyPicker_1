import type OpenAI from "openai";

import type { SavingsEvent, Portfolio } from "../types.js";
import { getState } from "../state/store.js";
import { refreshPortfolio } from "../state/portfolio.js";
import { EVENT_FIXTURES } from "../fixtures.js";
import { parseUsdcToMicro } from "../merchant/invest-route.js";
import { requestApproval } from "../orchestrator/approval-gate.js";
import {
  notifyUser,
  cancelSubscriptionForEvent,
  executeSweepForEvent,
} from "../orchestrator/actions.js";

/**
 * The six agent tools (SYSTEM_DESIGN §6). Schemas are authored in the OpenAI Responses-API flat
 * `FunctionTool` shape (`{ type, name, description, parameters, strict }`), verified against the installed
 * `openai` SDK and the live function-calling guide. Implementations delegate to orchestrator/state ONLY —
 * tools never touch Circle/contracts directly (those go through orchestrator/payments).
 */

// Fixtures (the two predefined savings events) come from the shared module ../fixtures.js.

// ---- JSON schemas handed to the OpenAI tool-calling model (Responses API) ----
export const TOOL_SCHEMAS: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "get_pending_events",
    description:
      "Return the savings event this conversation must handle, including its exact savings_usd amount, merchant, narrative, and pre_sweep_action.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "notify_user",
    description: "Send the user a short, friendly, plain-language message in the activity feed.",
    strict: true,
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "Plain-language message for the user." } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "request_approval",
    description:
      "Ask the user to approve an investment. Pauses until the user decides; resolves with their decision (APPROVED or DECLINED).",
    strict: true,
    parameters: {
      type: "object",
      properties: { proposal: { type: "string", description: "One-sentence approval proposal naming the amount and merchant." } },
      required: ["proposal"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "cancel_subscription",
    description:
      "Cancel the user's subscription with the given merchant before sweeping. Only valid after approval is APPROVED.",
    strict: true,
    parameters: {
      type: "object",
      properties: { merchant: { type: "string", description: "Merchant name whose subscription to cancel." } },
      required: ["merchant"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "execute_sweep",
    description:
      "Invest the exact saved amount into the user's mQQQ position via the x402 rail and on-chain mint. Only valid after approval is APPROVED.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        amount_usdc: { type: "string", description: "Exact amount as a 6-decimal USDC string, e.g. \"2.150000\"." },
        memo: { type: "string", description: "Memo of the form \"<event_id> <short description>\"." },
      },
      required: ["amount_usdc", "memo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_portfolio",
    description: "Read the user's current mQQQ portfolio position and totals.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

// ---- Tool implementations, bound to one event per conversation ----
export interface AgentToolContext {
  /** The event this conversation handles (e.g. "EVT-A-001"). */
  event_id: string;
  /** The session's ephemeral beneficiary address (generated at POST /api/demo/start; null pre-start). */
  beneficiary: string | null;
}

export interface AgentTools {
  get_pending_events(): { events: SavingsEvent[] };
  notify_user(args: { message: string }): { ok: true };
  request_approval(args: { proposal: string }): Promise<{ decision: "APPROVED" | "DECLINED" }>;
  cancel_subscription(args: { merchant: string }): Promise<{ confirmation_id: string }>;
  execute_sweep(args: { amount_usdc: string; memo: string }): Promise<{
    status: "MINTED";
    confirmation_ref: string;
    shares_minted: string;
    tx_hash: string;
  }>;
  get_portfolio(): Promise<Portfolio>;
}

/**
 * Build the six tool implementations bound to a specific event context. The agent loop (p4-t2) dispatches
 * model tool calls to these by name. The I-3 approval gate is enforced inside the orchestrator functions
 * these delegate to — not here.
 */
export function createAgentTools(ctx: AgentToolContext): AgentTools {
  return {
    get_pending_events: () => {
      const fixture = EVENT_FIXTURES[ctx.event_id];
      return { events: fixture ? [fixture] : [] };
    },
    notify_user: ({ message }) => {
      notifyUser(ctx.event_id, message);
      return { ok: true };
    },
    request_approval: async ({ proposal }) => {
      const approval = await requestApproval(ctx.event_id, proposal);
      return { decision: approval.decision === "APPROVED" ? "APPROVED" : "DECLINED" };
    },
    cancel_subscription: ({ merchant }) => cancelSubscriptionForEvent(ctx.event_id, merchant),
    execute_sweep: ({ amount_usdc, memo }) =>
      executeSweepForEvent(ctx.event_id, parseUsdcToMicro(amount_usdc), memo, ctx.beneficiary),
    get_portfolio: async () => {
      await refreshPortfolio();
      return getState().portfolio;
    },
  };
}
