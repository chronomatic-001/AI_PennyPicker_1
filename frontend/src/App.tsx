import { useState } from "react";
import { Play } from "lucide-react";

import { Header } from "@/components/Header";
import { FlowStrip } from "@/components/FlowStrip";
import { ActivityFeed } from "@/components/ActivityFeed";
import { PortfolioCard } from "@/components/PortfolioCard";
import { SettlementLedger } from "@/components/SettlementLedger";
import { Button } from "@/components/ui/button";
import { useDemoState } from "@/hooks/useDemoState";
import { useTheme } from "@/hooks/useTheme";
import { resetDemo, startDemo } from "@/lib/api";

function ConnectingLine() {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      connecting…
    </p>
  );
}

// Landing-page copy (operator-chosen "Option 2"). x402 is the OPEN protocol — the Circle Agent Stack
// (Gateway + Nanopayments) implements it; never present x402 as a Circle product (ENH-8 naming rule 1).
const LANDING_HEADLINE_TOP = "Autonomous micro-payments,";
const LANDING_HEADLINE_BOTTOM = "supervised by you.";
const LANDING_SUBTITLE =
  "An AI agent that catches your micro-savings and instantly invests them. Experience a live machine-to-machine workflow using the Circle Agent Stack and the open x402 protocol to mint mQQQ shares on the Arc Testnet.";

/** One preview card on the Launch Pad: the static $ amount, label, and merchant for an upcoming event. */
function EventPreviewCard({
  letter,
  amount,
  title,
  merchant,
}: {
  letter: string;
  amount: string;
  title: string;
  merchant: string;
}) {
  return (
    <div className="rounded-[10px] border border-border border-t-2 border-t-[var(--pp-primary)] bg-card p-4 text-left">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--pp-subtle)]">
        Event {letter}
      </p>
      <p className="mt-2 font-mono text-2xl font-bold text-[var(--accent-usdc)]">
        {amount}
      </p>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{merchant}</p>
    </div>
  );
}

/** Launch Pad — the full-width IDLE / post-Reset landing page (designUI/UI_LandingPad.png). */
function EmptyState({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center px-4 py-14 text-center">
      <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight text-foreground">
        {LANDING_HEADLINE_TOP}
        <br />
        {LANDING_HEADLINE_BOTTOM}
      </h1>
      <p className="mt-5 max-w-[600px] text-sm leading-relaxed text-muted-foreground">
        {LANDING_SUBTITLE}
      </p>

      <div className="mt-9 grid w-full max-w-[640px] grid-cols-1 gap-4 sm:grid-cols-2">
        <EventPreviewCard
          letter="A"
          amount="$2.15"
          title="Coffee Coupon"
          merchant="Daily Grind Coffee"
        />
        <EventPreviewCard
          letter="B"
          amount="$9.50"
          title="Subscription Leak"
          merchant="PixelGame Subscription"
        />
      </div>

      <Button className="mt-9" onClick={onStart} disabled={busy}>
        <Play />
        Start Demo
      </Button>

      <p className="mt-10 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--pp-subtle)]">
        Circle Gateway · Arc Testnet · x402 Protocol
      </p>
    </div>
  );
}

function App() {
  const { state } = useDemoState();
  const { isDark, toggle } = useTheme();
  const [busy, setBusy] = useState(false);

  const phase = state?.phase ?? "IDLE";
  const gatewayBalance = state?.portfolio.gateway_balance_usdc ?? "0";
  const mintedCount = state
    ? state.sweeps.filter((s) => s.state === "MINTED").length
    : 0;
  const paymentGoal = state ? Math.max(state.sweeps.length, 2) : 2;

  const handleStart = async () => {
    setBusy(true);
    try {
      await startDemo();
    } catch {
      // a 409 (already running) or transient error is reflected by the next poll
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      await resetDemo();
    } catch {
      // reflected by the next poll
    } finally {
      setBusy(false);
    }
  };

  const showEmpty =
    state !== null && state.phase === "IDLE" && state.feed.length === 0;
  const showFlow =
    state !== null && (state.phase !== "IDLE" || state.sweeps.length > 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        phase={phase}
        gatewayBalanceUsdc={gatewayBalance}
        busy={busy}
        isDark={isDark}
        onToggleTheme={toggle}
        onStart={handleStart}
        onReset={handleReset}
      />
      {showFlow && <FlowStrip state={state} />}
      <main className="mx-auto max-w-[1280px] px-6 pb-12 pt-5">
        {state === null ? (
          <ConnectingLine />
        ) : showEmpty ? (
          <EmptyState busy={busy} onStart={handleStart} />
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section>
              <ActivityFeed state={state} />
            </section>
            {/* Sticky so the Portfolio + Settlement cards stay in view as the feed grows and the page
                scrolls. self-start keeps the grid from stretching the aside; top-[72px] pins it just
                below the 56px sticky header. */}
            <aside className="space-y-5 lg:sticky lg:top-[72px] lg:self-start">
              <PortfolioCard
                portfolio={state.portfolio}
                investmentCount={mintedCount}
                paymentGoal={paymentGoal}
              />
              <SettlementLedger settlement={state.settlement} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
