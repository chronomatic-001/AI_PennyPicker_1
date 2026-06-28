import type { DemoState } from "../types.js";

const getPristineState = (): DemoState => ({
  phase: "IDLE",
  sweeps: [],
  pending_approval: null,
  feed: [],
  portfolio: {
    mqqq_balance: "0",
    total_swept_usdc: "0.000000",
    gateway_balance_usdc: "0.000000",
    beneficiary: null,
    links: {
      beneficiary: "",
      mqqq_token: "",
      vault: "",
      agent_wallet: "",
      seller: "",
    },
  },
  settlement: {
    total_confirmed_usdc: "0.000000",
    total_settled_usdc: "0.000000",
    records: [],
  },
});

let state: DemoState = getPristineState();
const subscribers: (() => void)[] = [];

/**
 * Returns a deep copy of the current DemoState.
 */
export function getState(): DemoState {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Updates the global state in-place using the updater function,
 * then notifies all subscribers.
 */
export function updateState(updater: (s: DemoState) => void): void {
  updater(state);
  notifySubscribers();
}

/**
 * Subscribes a callback listener function to state mutations.
 * Returns an unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  subscribers.push(listener);
  return () => {
    const idx = subscribers.indexOf(listener);
    if (idx !== -1) {
      subscribers.splice(idx, 1);
    }
  };
}

/**
 * Restores the global state to pristine IDLE conditions.
 */
export function resetState(): void {
  state = getPristineState();
  notifySubscribers();
}

function notifySubscribers(): void {
  for (const sub of subscribers) {
    try {
      sub();
    } catch {
      // Ignore subscriber errors to prevent interrupting state updates
    }
  }
}
