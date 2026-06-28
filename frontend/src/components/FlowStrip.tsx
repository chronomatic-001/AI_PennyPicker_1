import { Fragment } from "react";
import { Bot, Coins, TrendingUp, type LucideIcon } from "lucide-react";

import { formatMqqq, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DemoState, Sweep, SweepState } from "@/lib/types";

type NodeStatus = "done" | "current" | "pending";

// Sweep states that count as "still in flight" — used to pick the active event for the strip.
const FINAL_STATES: SweepState[] = ["MINTED", "DECLINED", "FAILED"];

/** EVT-A-001 → "A", EVT-B-001 → "B". */
function eventLetter(eventId: string | undefined): "A" | "B" | null {
  if (!eventId) return null;
  if (eventId.startsWith("EVT-A")) return "A";
  if (eventId.startsWith("EVT-B")) return "B";
  return null;
}

/** The sweep the strip should visualise: the pending-approval event, else an in-flight sweep, else the most recent. */
function pickActiveSweep(state: DemoState): Sweep | undefined {
  const byEvent = (id: string) => state.sweeps.find((s) => s.event_id === id);
  if (state.pending_approval) {
    const s = byEvent(state.pending_approval.event_id);
    if (s) return s;
  }
  const inFlight = state.sweeps.find((s) => !FINAL_STATES.includes(s.state));
  if (inFlight) return inFlight;
  return state.sweeps[state.sweeps.length - 1];
}

// Per-node [Savings, AI Agent, Nanopayments, PennyVault, mQQQ] status for a given sweep state.
function nodeStatuses(state: SweepState | null): NodeStatus[] {
  const d: NodeStatus = "done";
  const c: NodeStatus = "current";
  const p: NodeStatus = "pending";
  switch (state) {
    case null:
      return [p, p, p, p, p];
    case "RELEASED":
      return [c, p, p, p, p];
    case "NOTIFIED":
      case "AWAITING_APPROVAL":
      case "DECLINED":
        return [d, c, p, p, p];
      case "APPROVED":
      case "CANCELLING":
      case "CANCELLED":
      case "PAYMENT_REQUESTED":
      case "SIGNED":
      case "SUBMITTED":
      case "FAILED":
        return [d, d, c, p, p];
      case "VERIFIED":
        return [d, d, d, c, p];
      case "MINTED":
        return [d, d, d, d, d];
      default:
        return [p, p, p, p, p];
  }
}

function circleClass(status: NodeStatus, isMqqq: boolean): string {
  if (status === "current")
    return "border-[var(--pp-warning)] bg-[var(--pp-warning-bg)] pp-glow";
  if (status === "done")
    return isMqqq
      ? "border-[var(--pp-accent)] bg-[var(--pp-accent-bg)]"
      : "border-[var(--pp-primary)] bg-[var(--pp-primary-bg)]";
  return "border-[var(--pp-border)] bg-[var(--pp-surface2)]";
}

function contentColor(status: NodeStatus, isMqqq: boolean): string {
  if (status === "current") return "text-[var(--pp-warning)]";
  if (status === "done")
    return isMqqq ? "text-[var(--pp-accent)]" : "text-[var(--pp-primary)]";
  return "text-[var(--pp-subtle)]";
}

interface NodeDef {
  label: string;
  /** lucide icon, or a short mono badge string (x402 / ARC). */
  Icon?: LucideIcon;
  badge?: string;
  isMqqq?: boolean;
}

const NODES: NodeDef[] = [
  { label: "Savings\nEvent", Icon: Coins },
  { label: "AI\nAgent", Icon: Bot },
  { label: "Nanopayments", badge: "x402" },
  { label: "PennyVault", badge: "ARC" },
  { label: "mQQQ\nshares", Icon: TrendingUp, isMqqq: true },
];

const CONNECTOR_LABELS = ["detected", "approve", "settle", "mint"];

function FlowNode({
  node,
  status,
  value,
}: {
  node: NodeDef;
  status: NodeStatus;
  value?: string;
}) {
  const { Icon, badge, isMqqq = false, label } = node;
  const color = contentColor(status, isMqqq);
  return (
    <div className="flex w-[74px] shrink-0 flex-col items-center gap-1.5">
      <div
        className={cn(
          "flex h-[42px] w-[42px] items-center justify-center rounded-full border-2",
          circleClass(status, isMqqq),
        )}
      >
        {Icon ? (
          <Icon className={cn("h-[18px] w-[18px]", color)} strokeWidth={2} />
        ) : (
          <span className={cn("font-mono text-[10px] font-bold", color)}>
            {badge}
          </span>
        )}
      </div>
      <span
        className={cn(
          "flex h-[20px] items-start justify-center whitespace-pre-line text-center text-[8px] font-semibold uppercase leading-tight tracking-[0.06em]",
          color,
        )}
      >
        {label}
      </span>
      <span className={cn("h-3 font-mono text-[8px]", color)}>{value ?? ""}</span>
    </div>
  );
}

function Connector({
  label,
  leftDone,
  rightCurrent,
}: {
  label: string;
  leftDone: boolean;
  rightCurrent: boolean;
}) {
  const lineStyle = !leftDone
    ? { background: "var(--pp-border)" }
    : rightCurrent
      ? { background: "linear-gradient(to right,var(--pp-primary),var(--pp-warning))" }
      : { background: "var(--pp-primary)" };

  return (
    <div className="flex flex-1 flex-col items-center gap-1 pb-[19px]">
      {leftDone ? (
        <div className="h-[2px] w-full rounded-full" style={lineStyle} />
      ) : (
        <div
          className="h-[2px] w-full"
          style={{
            background:
              "repeating-linear-gradient(to right,var(--pp-border) 0,var(--pp-border) 5px,transparent 5px,transparent 10px)",
          }}
        />
      )}
      <span className="whitespace-nowrap text-[8px] text-[var(--pp-subtle)]">
        {label}
      </span>
    </div>
  );
}

interface FlowStripProps {
  state: DemoState;
}

/** Full-width payment-flow strip beneath the header. Reflects the active event's progress
 *  along the x402 rail. Naming is judge-facing precise: Nanopayments (Circle product, x402 = the
 *  open protocol badge) and PennyVault (our deployed contract, ARC = the chain badge). */
export function FlowStrip({ state }: FlowStripProps) {
  const active = pickActiveSweep(state);
  const sweepState = active?.state ?? null;
  const statuses = nodeStatuses(sweepState);
  const letter = eventLetter(active?.event_id);

  const label = letter
    ? `x402 payment rail · Event ${letter}`
    : "x402 payment rail";

  // Per-node value lines: amount under Savings, minted shares under mQQQ.
  const amount = active ? formatUsd(active.amount_usdc) : undefined;
  const shares =
    active?.state === "MINTED" && active.shares_minted
      ? `+${formatMqqq(active.shares_minted)}`
      : undefined;
  const nodeValues: (string | undefined)[] = [amount, undefined, undefined, undefined, shares];

  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto max-w-[1280px] px-6 pb-4 pt-3.5">
        <p className="mb-3 font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--pp-subtle)]">
          {label}
        </p>
        <div className="flex items-center">
          {NODES.map((node, i) => (
            <Fragment key={node.label}>
              {i > 0 && (
                <Connector
                  label={CONNECTOR_LABELS[i - 1]}
                  leftDone={statuses[i - 1] === "done"}
                  rightCurrent={statuses[i] === "current"}
                />
              )}
              <FlowNode node={node} status={statuses[i]} value={nodeValues[i]} />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
