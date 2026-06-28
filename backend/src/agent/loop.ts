import OpenAI from "openai";
import pino from "pino";

import { config } from "../config.js";
import type { SweepState } from "../types.js";
import { getState, updateState } from "../state/store.js";
import { AppError } from "../orchestrator/sweep-client.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { TOOL_SCHEMAS, createAgentTools, type AgentTools } from "./tools.js";

/**
 * The thin OpenAI tool-calling agent loop (SYSTEM_DESIGN §6). One conversation per event, stateless
 * accumulation (resend the growing input array each turn — the documented Responses-API idiom), hard stop at
 * MAX_TURNS → FAILED. Every model tool call emits a TOOL_CALL feed item (I-8); state transitions are emitted by
 * the orchestrator actions the tools delegate to. The agent does ZERO reasoning about money — the I-3 gate and
 * the state machine live in the backend, so the worst a misbehaving model can do is drive an event to FAILED.
 */

const logger = pino({ name: "agent-loop" });
const MAX_TURNS = 12;
const TERMINAL_STATES: readonly SweepState[] = ["MINTED", "DECLINED", "FAILED"];

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// gpt-5.x reasoning models reject `temperature`; classic models accept it. Probe once, then remember.
let modelSupportsTemperature = true;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function currentState(event_id: string): SweepState | undefined {
  return getState().sweeps.find((sw) => sw.event_id === event_id)?.state;
}

function emitToolCall(event_id: string, name: string): void {
  const now = new Date().toISOString();
  updateState((s) => {
    s.feed.push({
      id: `feed-tool-${event_id}-${name}-${Date.now()}`,
      ts: now,
      kind: "TOOL_CALL",
      event_id,
      text: `Agent → ${name}`,
    });
  });
}

function ensureFailed(event_id: string, message: string): void {
  const now = new Date().toISOString();
  updateState((s) => {
    const sweep = s.sweeps.find((sw) => sw.event_id === event_id);
    if (sweep && !TERMINAL_STATES.includes(sweep.state)) {
      sweep.failure = { at: sweep.state, message };
      sweep.state = "FAILED";
      sweep.timestamps.FAILED = now;
      s.feed.push({
        id: `feed-error-${event_id}-${Date.now()}`,
        ts: now,
        kind: "ERROR",
        event_id,
        text: `Agent run failed: ${message}`,
      });
    }
  });
}

/** Run the model once. Probes `temperature:0` and falls back to the model default if rejected. */
async function createResponse(
  input: OpenAI.Responses.ResponseInputItem[],
): Promise<OpenAI.Responses.Response> {
  const base: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: config.AGENT_MODEL,
    instructions: SYSTEM_PROMPT,
    input,
    tools: TOOL_SCHEMAS,
    parallel_tool_calls: false,
    store: false,
  };
  if (modelSupportsTemperature) {
    try {
      return await client.responses.create({ ...base, temperature: 0 });
    } catch (err) {
      if (!/temperature/i.test(errMessage(err))) throw err;
      modelSupportsTemperature = false;
      logger.warn("AGENT_MODEL rejected temperature:0; continuing with the model default");
    }
  }
  return await client.responses.create(base);
}

async function dispatchTool(tools: AgentTools, name: string, argsJson: string): Promise<unknown> {
  const args = (argsJson ? JSON.parse(argsJson) : {}) as Record<string, unknown>;
  switch (name) {
    case "get_pending_events":
      return tools.get_pending_events();
    case "notify_user":
      return tools.notify_user(args as { message: string });
    case "request_approval":
      return tools.request_approval(args as { proposal: string });
    case "cancel_subscription":
      return tools.cancel_subscription(args as { merchant: string });
    case "execute_sweep":
      return tools.execute_sweep(args as { amount_usdc: string; memo: string });
    case "get_portfolio":
      return tools.get_portfolio();
    default:
      throw new AppError("UNKNOWN_TOOL", `Model called unknown tool: ${name}`);
  }
}

/**
 * Drive one event end-to-end via the agent. Parks at `request_approval` until the human settles it (no timeout
 * — the pause is presenter-controlled, §8). Returns the event's terminal SweepState (MINTED | DECLINED | FAILED).
 */
export async function runAgentForEvent(event_id: string): Promise<SweepState> {
  const beneficiary = getState().portfolio.beneficiary;
  const tools = createAgentTools({ event_id, beneficiary });

  const input: OpenAI.Responses.ResponseInputItem[] = [
    {
      role: "user",
      content: `A new savings event (${event_id}) is ready for you. Handle it now, following your loop.`,
    },
  ];

  logger.info({ event_id }, "agent run starting");

  let response: OpenAI.Responses.Response;
  try {
    response = await createResponse(input);
  } catch (err) {
    ensureFailed(event_id, `OpenAI request failed: ${errMessage(err)}`);
    return currentState(event_id) ?? "FAILED";
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    if (calls.length === 0) break; // model produced its final message — no more tool calls

    input.push(...calls); // preserve the model's tool calls for the next turn's context

    let failed = false;
    for (const call of calls) {
      emitToolCall(event_id, call.name);
      try {
        const result = await dispatchTool(tools, call.name, call.arguments);
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      } catch (err) {
        logger.warn({ event_id, tool: call.name }, "tool call failed");
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ error: errMessage(err) }),
        });
        failed = true;
      }
    }
    if (failed) break; // a money tool threw (the orchestrator already marked the sweep FAILED); no auto-retry

    try {
      response = await createResponse(input);
    } catch (err) {
      ensureFailed(event_id, `OpenAI request failed: ${errMessage(err)}`);
      return currentState(event_id) ?? "FAILED";
    }
  }

  const state = currentState(event_id);
  if (!state || !TERMINAL_STATES.includes(state)) {
    ensureFailed(event_id, "agent finished without reaching a terminal state (turn cap or incomplete run)");
  }
  const finalState = currentState(event_id) ?? "FAILED";
  logger.info({ event_id, state: finalState }, "agent run finished");
  return finalState;
}
