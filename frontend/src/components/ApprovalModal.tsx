import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { decideApproval } from "@/lib/api";
import type { Approval } from "@/lib/types";

interface ApprovalModalProps {
  approval: Approval | null;
}

/**
 * The I-3 approval gate, rendered as a non-dismissable dialog. Opens whenever the backend exposes a
 * pending approval; the only exits are Approve / Decline, which POST the decision and let the next
 * poll clear the gate. Buttons lock after a click until that poll confirms.
 */
export function ApprovalModal({ approval }: ApprovalModalProps) {
  const [submitting, setSubmitting] = useState<"APPROVED" | "DECLINED" | null>(
    null,
  );

  // Release the lock whenever the active gate changes (new event) or clears (decision settled).
  useEffect(() => {
    setSubmitting(null);
  }, [approval?.event_id]);

  const decide = async (decision: "APPROVED" | "DECLINED") => {
    if (!approval) return;
    setSubmitting(decision);
    try {
      await decideApproval(approval.event_id, decision);
    } catch {
      setSubmitting(null); // POST failed — re-enable so the human can retry
    }
  };

  return (
    <Dialog open={approval !== null}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md border-border bg-card"
      >
        <DialogHeader>
          <DialogTitle className="text-base">Approval required</DialogTitle>
          <DialogDescription className="sr-only">
            Review the agent's proposed action and approve or decline it.
          </DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {approval?.proposal}
        </p>
        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            className="w-full"
            onClick={() => decide("APPROVED")}
            disabled={submitting !== null}
          >
            {submitting === "APPROVED" ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => decide("DECLINED")}
            disabled={submitting !== null}
          >
            {submitting === "DECLINED" ? "Declining…" : "Decline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
