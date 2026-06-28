import { FeedItemCard } from "@/components/FeedItemCard";
import type { DemoState, Sweep, SweepState } from "@/lib/types";

// States where a sweep is actively working (between approval and a terminal outcome).
const PROCESSING_STATES: SweepState[] = [
  "NOTIFIED",
  "CANCELLING",
  "PAYMENT_REQUESTED",
  "SIGNED",
  "SUBMITTED",
];

interface ActivityFeedProps {
  state: DemoState;
}

/**
 * Newest-first feed. It grows with the page (no internal scroll box) so the whole page scrolls and
 * the sticky Portfolio/Settlement sidebar stays in view as cards stack up.
 */
export function ActivityFeed({ state }: ActivityFeedProps) {
  const sweepByEvent = new Map<string, Sweep>(
    state.sweeps.map((s) => [s.event_id, s]),
  );

  // The single in-progress item: newest feed entry for a sweep that is actively processing.
  let inProgressId: string | null = null;
  if (state.phase === "RUNNING" && state.pending_approval === null) {
    const active = state.sweeps.find((s) => PROCESSING_STATES.includes(s.state));
    if (active) {
      for (let i = state.feed.length - 1; i >= 0; i--) {
        if (state.feed[i].event_id === active.event_id) {
          inProgressId = state.feed[i].id;
          break;
        }
      }
    }
  }

  let pendingApprovalFeedId: string | null = null;
  if (state.pending_approval?.decision === "PENDING") {
    for (let i = state.feed.length - 1; i >= 0; i--) {
      const item = state.feed[i];
      if (
        item.kind === "APPROVAL_REQUEST" &&
        item.event_id === state.pending_approval.event_id
      ) {
        pendingApprovalFeedId = item.id;
        break;
      }
    }
  }

  const items = [...state.feed].reverse();

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <FeedItemCard
          key={item.id}
          item={item}
          sweep={item.event_id ? sweepByEvent.get(item.event_id) : undefined}
          pendingApproval={
            item.id === pendingApprovalFeedId ? state.pending_approval : null
          }
          pulse={item.id === inProgressId}
        />
      ))}
    </div>
  );
}
