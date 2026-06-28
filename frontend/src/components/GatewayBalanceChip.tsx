import { cn } from "@/lib/utils";

interface GatewayBalanceChipProps {
  /** Gateway USDC balance as a 6-decimal string from the state projection. */
  balanceUsdc: string;
  className?: string;
}

/** Header chip: the funded Circle Gateway balance the agent sweeps from (USDC, 2 decimals). */
export function GatewayBalanceChip({
  balanceUsdc,
  className,
}: GatewayBalanceChipProps) {
  const value = Number.parseFloat(balanceUsdc);
  const display = Number.isFinite(value) ? value.toFixed(2) : "—";

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3",
        className,
      )}
      title="Circle Gateway balance"
    >
      <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--pp-subtle)]">
        Gateway
      </span>
      <span className="font-mono text-sm font-semibold text-[var(--accent-usdc)]">
        ${display}
      </span>
    </div>
  );
}
