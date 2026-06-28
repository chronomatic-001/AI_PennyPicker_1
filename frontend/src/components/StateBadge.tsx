import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SweepState } from "@/lib/types";

type Tone = "success" | "warning" | "danger" | "muted";

// Sweep state → semantic tone (ui-context color map). In-progress/pending → warning;
// positive resolutions → success; failures/declines → danger; anything unknown → muted.
const STATE_TONE: Record<SweepState, Tone> = {
  RELEASED: "warning",
  NOTIFIED: "warning",
  AWAITING_APPROVAL: "warning",
  CANCELLING: "warning",
  PAYMENT_REQUESTED: "warning",
  SIGNED: "warning",
  SUBMITTED: "warning",
  APPROVED: "success",
  CANCELLED: "success",
  VERIFIED: "success",
  MINTED: "success",
  DECLINED: "danger",
  FAILED: "danger",
};

const TONE_CLASS: Record<Tone, string> = {
  success:
    "text-[var(--success)] border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)]",
  warning:
    "text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]",
  danger:
    "text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]",
  muted: "text-muted-foreground border-border bg-secondary",
};

export function stateTone(state: string): Tone {
  return (STATE_TONE as Record<string, Tone>)[state] ?? "muted";
}

interface StateBadgeProps {
  state: SweepState | string;
  className?: string;
}

/** Pill, mono-uppercase-xs, colored per the sweep-state → tone mapping. Unknown states render muted. */
export function StateBadge({ state, className }: StateBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] font-medium uppercase tracking-wide",
        TONE_CLASS[stateTone(state)],
        className,
      )}
    >
      {state}
    </Badge>
  );
}
