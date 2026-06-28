import { Router } from "express";
import { z } from "zod";
import { getState, resetState } from "./store.js";
import { refreshPortfolio } from "./portfolio.js";
import { startDemo } from "../orchestrator/run.js";
import { settleApproval } from "../orchestrator/approval-gate.js";

export const stateRouter = Router();
export const demoRouter = Router();
export const approvalsRouter = Router();

stateRouter.get("/", (req, res) => {
  res.json(getState());
});

demoRouter.post("/reset", async (req, res) => {
  resetState();
  // Perform an immediate refresh so the returned state is instantly clean and up to date
  await refreshPortfolio();
  res.json({ phase: "IDLE" });
});

// POST /api/demo/start — generate the session beneficiary, release Event A, kick off the A→B chain (409 if not IDLE).
demoRouter.post("/start", (req, res) => {
  if (getState().phase !== "IDLE") {
    return res.status(409).json({ error: "demo not idle", phase: getState().phase });
  }
  return res.status(200).json(startDemo());
});

// POST /api/approvals/:event_id — settle a pending approval and unblock the parked agent (SYSTEM_DESIGN §3.4).
const approvalBodySchema = z.object({ decision: z.enum(["APPROVED", "DECLINED"]) });

approvalsRouter.post("/:event_id", (req, res) => {
  const parsed = approvalBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid decision", issues: parsed.error.issues });
  }
  const { event_id } = req.params;
  const approval = getState().sweeps.find((sw) => sw.event_id === event_id)?.approval;
  if (!approval) return res.status(404).json({ error: `no pending approval for ${event_id}` });
  if (approval.decision !== "PENDING") {
    return res.status(409).json({ error: `approval already ${approval.decision}` });
  }
  return res.status(200).json(settleApproval(event_id, parsed.data.decision));
});
