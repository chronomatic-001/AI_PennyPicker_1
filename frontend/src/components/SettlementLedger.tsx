import { Card } from "@/components/ui/card";
import { formatClock, formatUsd, truncateMiddle } from "@/lib/format";
import type { SettlementLedger as SettlementLedgerData } from "@/lib/types";

interface SettlementLedgerProps {
  settlement: SettlementLedgerData;
}

/**
 * Confirmed (verified sweeps) vs Settled (landed batches), a progress bar, and per-batch rows.
 * Typography mirrors the Portfolio card (9px subtle labels, 17px bold mono values, 10px mono rows).
 */
export function SettlementLedger({ settlement }: SettlementLedgerProps) {
  const confirmed = Number.parseFloat(settlement.total_confirmed_usdc) || 0;
  const settled = Number.parseFloat(settlement.total_settled_usdc) || 0;
  const pct = confirmed > 0 ? Math.min(100, (settled / confirmed) * 100) : 0;

  return (
    <Card className="overflow-hidden rounded-[10px] border border-border bg-card shadow-none">
      <div className="px-[18px] pb-3 pt-[18px]">
        <p className="mb-3 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--pp-subtle)]">
          Settlement ledger
        </p>

        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
              Confirmed
            </p>
            <p className="font-mono text-[17px] font-bold text-foreground">
              {formatUsd(settlement.total_confirmed_usdc)}
            </p>
          </div>
          <div className="text-right">
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
              Settled
            </p>
            <p className="font-mono text-[17px] font-bold text-[var(--success)]">
              {formatUsd(settlement.total_settled_usdc)}
            </p>
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--pp-surface2)]">
          <div
            className="h-full rounded-full bg-[var(--success)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="border-t border-border px-[18px] py-3">
        {settlement.records.length > 0 ? (
          <div className="space-y-1.5">
            {settlement.records.map((record) => (
              <div
                key={record.batch_ref}
                className="flex items-center gap-2"
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground"
                  title={record.batch_ref}
                >
                  {truncateMiddle(record.batch_ref, 6, 4)}
                </span>
                <span className="shrink-0 font-mono text-[10px] font-semibold text-[var(--accent-usdc)]">
                  {formatUsd(record.amount_usdc)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--pp-subtle)]">
                  {formatClock(record.ts)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Awaiting first batch settlement…
          </p>
        )}
      </div>
    </Card>
  );
}
