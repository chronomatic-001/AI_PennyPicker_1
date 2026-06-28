import {
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StateBadge } from "@/components/StateBadge";
import { useCopy } from "@/hooks/useCopy";
import { decideApproval } from "@/lib/api";
import { formatClock, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Approval, FeedItem, FeedKind, FeedRef, Sweep } from "@/lib/types";

type Accent = "primary" | "success" | "warning" | "danger" | "neutral";

const KIND_META: Record<FeedKind, { label: string; accent: Accent }> = {
  EVENT_CARD: { label: "Found money", accent: "primary" },
  AGENT_NOTE: { label: "Agent", accent: "neutral" },
  TOOL_CALL: { label: "Tool call", accent: "neutral" },
  STATE_CHANGE: { label: "Update", accent: "neutral" },
  APPROVAL_REQUEST: { label: "Awaiting your approval", accent: "warning" },
  APPROVAL_DECISION: { label: "Decision", accent: "neutral" },
  RECEIPT: { label: "Receipt", accent: "success" },
  ERROR: { label: "Error", accent: "danger" },
};

const ACCENT_STRIP: Record<Accent, string> = {
  primary: "border-l-[var(--pp-primary)]",
  success: "border-l-[var(--pp-success)]",
  warning: "border-l-[var(--pp-warning)]",
  danger: "border-l-[var(--pp-danger)]",
  neutral: "border-l-[var(--pp-border)]",
};

// EVENT_CARD/neutral cards sit on plain surface; receipts/errors/approvals tint the surface + border.
const ACCENT_SURFACE: Record<Accent, string> = {
  primary: "bg-card",
  neutral: "bg-card",
  success: "bg-[var(--pp-success-bg)] border-[var(--pp-success-border)]",
  warning: "bg-[var(--pp-warning-bg)] border-[var(--pp-warning-border)]",
  danger: "bg-[var(--pp-danger-bg)] border-[var(--pp-danger-border)]",
};

const LABEL_COLOR: Record<Accent, string> = {
  primary: "text-[var(--pp-subtle)]",
  neutral: "text-[var(--pp-subtle)]",
  success: "text-[var(--pp-success)]",
  warning: "text-[var(--pp-warning)]",
  danger: "text-[var(--pp-danger)]",
};

/** A mono reference row with copy-to-clipboard and an optional explorer link. */
function RefRow({ label, value, href }: FeedRef) {
  const { copied, copy } = useCopy();

  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-border bg-[var(--pp-surface)] px-2 py-1">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-xs text-foreground" title={value}>
        {truncateMiddle(value)}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => copy(value)}
          aria-label={`Copy ${label}`}
          className="rounded p-1 text-[var(--pp-subtle)] transition-colors hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${label} in explorer`}
            className="rounded p-1 text-[var(--pp-subtle)] transition-colors hover:text-[var(--primary)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function InlineApprovalControls({ approval }: { approval: Approval }) {
  const [submitting, setSubmitting] = useState<"APPROVED" | "DECLINED" | null>(
    null,
  );

  useEffect(() => {
    setSubmitting(null);
  }, [approval.event_id, approval.decision]);

  const decide = async (
    event: MouseEvent<HTMLButtonElement>,
    decision: "APPROVED" | "DECLINED",
  ) => {
    event.stopPropagation();
    setSubmitting(decision);
    try {
      await decideApproval(approval.event_id, decision);
    } catch {
      setSubmitting(null);
    }
  };

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={(event) => decide(event, "APPROVED")}
        disabled={submitting !== null}
        className="rounded-[6px] bg-[var(--pp-primary)] px-3 py-2.5 text-xs font-semibold text-white transition-opacity disabled:cursor-wait disabled:opacity-70"
      >
        {submitting === "APPROVED" ? "Approving..." : "Approve"}
      </button>
      <button
        type="button"
        onClick={(event) => decide(event, "DECLINED")}
        disabled={submitting !== null}
        className="rounded-[6px] border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-70"
      >
        {submitting === "DECLINED" ? "Declining..." : "Decline"}
      </button>
    </div>
  );
}

/** Collapsed/expanded terminal header — always-dark bar with the real HTTP method + status. */
function PaymentTerminalHeader({ item, expanded }: { item: FeedItem; expanded: boolean }) {
  const views = item.payment_views;
  if (!views) return null;

  let text = "";
  let color = "";
  if (views.requirements) {
    text = "GET /api/invest → HTTP 402 Payment Required";
    color = "text-[var(--pp-term-warn)]";
  } else if (views.authorization) {
    text = "POST /api/invest (PAYMENT-SIGNATURE) → 200 OK";
    color = "text-[var(--pp-term-ok)]";
  } else if (views.response) {
    text = "HTTP/1.1 200 OK (PAYMENT-RESPONSE)";
    color = "text-[var(--pp-term-ok)]";
  }

  return (
    <div
      className={cn(
        "mt-2 flex cursor-pointer select-none items-center justify-between border border-[var(--pp-term-border)] bg-[var(--pp-term-bg)] px-2.5 py-1.5",
        expanded ? "rounded-t-[5px]" : "rounded-[5px]",
      )}
    >
      <span className={cn("truncate font-mono text-[11px]", color)} title={text}>
        {text}
      </span>
      <ChevronDown
        className={cn(
          "ml-2 h-3.5 w-3.5 shrink-0 text-[var(--pp-term-dim)] transition-transform duration-200",
          expanded && "rotate-180",
        )}
      />
    </div>
  );
}

/** One syntax-highlighted JSON line inside the terminal body. */
function TermField({
  k,
  value,
  type,
  comment,
}: {
  k: string;
  value: string;
  type: "string" | "number";
  comment?: string;
}) {
  return (
    <div className="pl-4">
      <span className="text-[var(--pp-term-key)]">"{k}"</span>
      <span className="text-[var(--pp-term-text)]">: </span>
      {type === "string" ? (
        <span className="text-[var(--pp-term-string)]">"{value}"</span>
      ) : (
        <span className="text-[var(--pp-term-number)]">{value}</span>
      )}
      <span className="text-[var(--pp-term-text)]">,</span>
      {comment && <span className="text-[var(--pp-term-dim)]"> {comment}</span>}
    </div>
  );
}

/** Always-dark terminal body with the real log-safe x402 / EIP-3009 view. */
function PaymentTerminalDetails({ item }: { item: FeedItem }) {
  const views = item.payment_views;
  if (!views) return null;

  let title = "";
  let fields: ReactNode = null;

  if (views.requirements) {
    const r = views.requirements;
    title = "PAYMENT REQUIRED · x402";
    fields = (
      <>
        <TermField k="scheme" value={r.scheme} type="string" />
        <TermField k="network" value={r.network} type="string" />
        <TermField k="asset" value={truncateMiddle(r.asset, 6, 4)} type="string" />
        <TermField k="amount" value={r.amount} type="number" />
        <TermField k="payTo" value={truncateMiddle(r.payTo, 6, 4)} type="string" />
        <TermField
          k="verifyingContract"
          value={truncateMiddle(r.verifyingContract, 6, 4)}
          type="string"
        />
      </>
    );
  } else if (views.authorization) {
    const a = views.authorization;
    title = "PAYMENT SIGNATURE · EIP-3009";
    fields = (
      <>
        <TermField k="from" value={truncateMiddle(a.from, 6, 4)} type="string" />
        <TermField k="to" value={truncateMiddle(a.to, 6, 4)} type="string" />
        <TermField k="value" value={a.value} type="number" />
        <TermField k="nonce" value={truncateMiddle(a.nonce, 6, 4)} type="string" />
        <TermField
          k="signature"
          value={a.signature_truncated}
          type="string"
          comment="/* truncated */"
        />
      </>
    );
  } else if (views.response) {
    const p = views.response;
    title = "PAYMENT RESPONSE";
    fields = (
      <>
        <TermField k="status" value={p.status} type="string" />
        <TermField
          k="confirmation_ref"
          value={truncateMiddle(p.confirmation_ref, 8, 6)}
          type="string"
        />
      </>
    );
  } else {
    return null;
  }

  return (
    <div className="rounded-b-[5px] border border-t-0 border-[var(--pp-term-border)] bg-[var(--pp-term-bg)] px-3 py-2.5">
      <p className="mb-2 font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--pp-term-dim)]">
        {title}
      </p>
      <div className="font-mono text-[11px] leading-[1.75]">
        <div className="text-[var(--pp-term-text)]">{"{"}</div>
        {fields}
        <div className="text-[var(--pp-term-text)]">{"}"}</div>
      </div>
    </div>
  );
}

interface FeedItemCardProps {
  item: FeedItem;
  sweep?: Sweep;
  pendingApproval?: Approval | null;
  /** When true, this is the single actively-processing item — render a subtle pulse. */
  pulse?: boolean;
}

export function FeedItemCard({
  item,
  sweep,
  pendingApproval,
  pulse,
}: FeedItemCardProps) {
  const meta = KIND_META[item.kind];
  const isEvent = item.kind === "EVENT_CARD";
  const showApprovalControls =
    item.kind === "APPROVAL_REQUEST" &&
    pendingApproval?.decision === "PENDING" &&
    pendingApproval.event_id === item.event_id;
  const hasTerminal = !!item.payment_views;
  const [expanded, setExpanded] = useState(false);

  const handleClick = hasTerminal ? () => setExpanded((prev) => !prev) : undefined;
  const displayText = showApprovalControls ? pendingApproval.proposal : item.text;

  return (
    <Card
      className={cn(
        "border border-l-[3px] p-3 shadow-none transition-colors duration-200",
        showApprovalControls && "px-4 py-3.5",
        ACCENT_STRIP[meta.accent],
        ACCENT_SURFACE[meta.accent],
        pulse && "ring-1 ring-[var(--pp-warning-border)]",
        hasTerminal && "cursor-pointer",
      )}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {(pulse || showApprovalControls) && (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--pp-warning)] pp-blink" />
          )}
          <span
            className={cn(
              "text-[9px] font-semibold uppercase tracking-[0.1em]",
              LABEL_COLOR[meta.accent],
            )}
          >
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isEvent && sweep && (
            <span className="font-mono text-sm font-bold text-[var(--accent-usdc)]">
              ${sweep.amount_usdc.toFixed(2)}
            </span>
          )}
          {isEvent && sweep && <StateBadge state={sweep.state} />}
          <time className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--pp-subtle)]">
            {formatClock(item.ts)}
          </time>
        </div>
      </div>

      {displayText && (
        <p
          className={cn(
            "mt-1.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground",
            isEvent && "font-medium",
            showApprovalControls && "mt-3 text-sm leading-relaxed",
          )}
        >
          {displayText}
        </p>
      )}

      {item.ref && <RefRow {...item.ref} />}
      {showApprovalControls && <InlineApprovalControls approval={pendingApproval} />}

      {hasTerminal && <PaymentTerminalHeader item={item} expanded={expanded} />}

      {/* Collapsible terminal block — CSS grid-rows transition for a smooth slide. */}
      <div
        className="grid transition-[grid-template-rows] duration-300"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {hasTerminal && <PaymentTerminalDetails item={item} />}
        </div>
      </div>
    </Card>
  );
}
