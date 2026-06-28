import { Check, Copy, ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useCopy } from "@/hooks/useCopy";
import { formatMqqq, formatUsd, truncateMiddle } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

interface PortfolioCardProps {
  portfolio: Portfolio;
  /** Sweeps that reached MINTED — the numerator of the demo payments figure. */
  investmentCount: number;
  /** Total expected demo payments, shown as N of total while the two-event run progresses. */
  paymentGoal: number;
}

function PortfolioLinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded border border-border bg-[var(--pp-surface2)] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-[var(--primary)]"
    >
      <span>{label}</span>
      <ExternalLink className="h-2.5 w-2.5 text-[var(--pp-subtle)]" />
    </a>
  );
}

/** Closing-frame portfolio: mQQQ headline, value math, session beneficiary, and explorer links. */
export function PortfolioCard({
  portfolio,
  investmentCount,
  paymentGoal,
}: PortfolioCardProps) {
  const { copied, copy } = useCopy();
  const { beneficiary, links } = portfolio;

  return (
    <Card className="overflow-hidden rounded-[10px] border border-border bg-card shadow-none">
      <div className="px-[18px] pb-3 pt-[18px]">
        <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--pp-subtle)]">
          Portfolio
        </p>
        <p className="mb-3 text-[10px] text-[var(--pp-border)]">
          Mock Tokenized Nasdaq-100 ETF
        </p>

        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[44px] font-bold leading-none text-[var(--accent-mqqq)]">
            {formatMqqq(portfolio.mqqq_balance)}
          </span>
        </div>
        <p className="mb-3 text-[13px] font-semibold text-[var(--accent-mqqq)] opacity-75">
          mQQQ shares
        </p>

        <div className="mb-3 rounded-[6px] border border-[var(--pp-accent-border)] bg-[var(--pp-accent-bg)] px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-[9px] font-medium text-muted-foreground">
              Fixed NAV
            </span>
            <span className="font-mono text-[10px] font-semibold text-foreground">
              500 USDC / share
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[9px] font-medium text-muted-foreground">
              Position value
            </span>
            <span className="font-mono text-[10px] font-semibold text-[var(--accent-usdc)]">
              ≈ {formatUsd(portfolio.total_swept_usdc)}
            </span>
          </div>
        </div>

        <div className="flex items-start justify-between border-t border-border pt-3">
          <div>
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
              Total swept
            </p>
            <p className="font-mono text-[17px] font-bold text-[var(--accent-usdc)]">
              {formatUsd(portfolio.total_swept_usdc)}
            </p>
          </div>
          <div className="text-right">
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
              Payments
            </p>
            <p className="font-mono text-[17px] font-bold text-foreground">
              {investmentCount} of {paymentGoal}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-[18px] py-3">
        <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
          Session beneficiary (Portfolio Address)
        </p>
        {beneficiary ? (
          <div className="flex items-center gap-1 rounded-[5px] border border-border bg-[var(--pp-surface2)] px-2 py-1.5">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground"
              title={beneficiary}
            >
              {truncateMiddle(beneficiary, 8, 6)}
            </span>
            <button
              type="button"
              onClick={() => copy(beneficiary)}
              aria-label="Copy beneficiary address"
              className="flex h-[22px] w-[22px] items-center justify-center rounded text-[var(--pp-subtle)] transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3 w-3 text-[var(--success)]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            {links.beneficiary && (
              <a
                href={links.beneficiary}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Open beneficiary in explorer"
                className="flex h-[22px] w-[22px] items-center justify-center rounded text-[var(--pp-subtle)] transition-colors hover:text-[var(--primary)]"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <p className="rounded-[5px] border border-border bg-[var(--pp-surface2)] px-2 py-2 text-xs text-muted-foreground">
            No active session — press Start Demo.
          </p>
        )}
      </div>

      {(links.mqqq_token || links.vault || links.agent_wallet || links.seller) && (
        <div className="border-t border-border px-[18px] pb-3.5 pt-2.5">
          <p className="mb-2 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--pp-subtle)]">
            Contracts &amp; wallets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {links.mqqq_token && (
              <PortfolioLinkChip href={links.mqqq_token} label="mQQQ token" />
            )}
            {links.vault && (
              <PortfolioLinkChip href={links.vault} label="PennyVault" />
            )}
            {links.agent_wallet && (
              <PortfolioLinkChip href={links.agent_wallet} label="Agent wallet" />
            )}
            {links.seller && (
              <PortfolioLinkChip href={links.seller} label="Seller Address" />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
