// ---- Fixtures (read-only) ----
export interface SavingsEvent {
  event_id: string;                       // "EVT-A-001" | "EVT-B-001"
  type: "COUPON_DELTA" | "SUBSCRIPTION_LEAK";
  narrative: string;
  merchant: string;
  savings_usd: number;                    // 2.15 | 9.50
  pre_sweep_action: null | "CANCEL_SUBSCRIPTION";
  detected_at: string;                    // ISO 8601
  [k: string]: unknown;
}

// ---- Sweep lifecycle (the core state machine) ----
export type SweepState =
  | "RELEASED"
  | "NOTIFIED"
  | "AWAITING_APPROVAL"
  | "DECLINED"
  | "APPROVED"
  | "CANCELLING"
  | "CANCELLED"
  | "PAYMENT_REQUESTED"
  | "SIGNED"
  | "SUBMITTED"
  | "VERIFIED"
  | "MINTED"
  | "FAILED";

export interface Sweep {
  event_id: string;
  state: SweepState;
  amount_usdc: number;
  memo: string;
  approval?: Approval;
  cancel_confirmation_id?: string;
  payment_requirements?: unknown;
  confirmation_ref?: string;
  payment_ref?: string;
  shares_minted?: string;
  mint_tx_hash?: string;
  failure?: { at: SweepState; message: string };
  timestamps: Partial<Record<SweepState, string>>;
}

export interface Approval {
  event_id: string;
  proposal: string;
  decision: "PENDING" | "APPROVED" | "DECLINED";
  decided_at?: string;
}

// ---- Feed & state projection ----

/** Log-safe x402 challenge view (no secret material). */
export interface PaymentRequirementsView {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  verifyingContract: string;
}

/** Log-safe EIP-3009 authorization view (signature middle-truncated per I-10). */
export interface AuthorizationView {
  from: string;
  to: string;
  value: string;
  nonce: string;
  signature_truncated: string;
}

/** Log-safe payment response view. */
export interface PaymentResponseView {
  status: string;
  confirmation_ref: string;
}

export interface FeedItem {
  id: string;
  ts: string;
  kind: "EVENT_CARD" | "AGENT_NOTE" | "TOOL_CALL" | "STATE_CHANGE"
      | "APPROVAL_REQUEST" | "APPROVAL_DECISION" | "RECEIPT" | "ERROR";
  event_id?: string;
  text: string;
  ref?: { label: string; value: string; href?: string };
  /** x402/EIP-3009 cryptographic details for collapsible terminal blocks (ENH-4). */
  payment_views?: {
    requirements?: PaymentRequirementsView;
    authorization?: AuthorizationView;
    response?: PaymentResponseView;
  };
}

export interface Portfolio {
  mqqq_balance: string;
  total_swept_usdc: string;
  gateway_balance_usdc: string;
  beneficiary: string | null;
  links: { beneficiary: string; mqqq_token: string; vault: string; agent_wallet: string; seller: string };
}

export interface SettlementLedger {
  total_confirmed_usdc: string;
  total_settled_usdc: string;
  records: { batch_ref: string; amount_usdc: string; ts: string }[];
}

export interface DemoState {
  phase: "IDLE" | "RUNNING" | "COMPLETE";
  sweeps: Sweep[];
  pending_approval: Approval | null;
  feed: FeedItem[];
  portfolio: Portfolio;
  settlement: SettlementLedger;
}
