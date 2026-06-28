import { Router, type Request, type Response } from "express";
import pino from "pino";
import { z } from "zod";

/**
 * `POST /api/merchant/cancel` — mock subscription-cancel endpoint (SYSTEM_DESIGN §3.6).
 *
 * Always succeeds, returns a fixed confirmation id, and adds ~800ms of artificial latency so the
 * CANCELLING → CANCELLED transition is legible in the demo feed (I-8). It is called by the agent's
 * `cancel_subscription` tool over loopback HTTP, mirroring the honest /api/invest exchange.
 */

const logger = pino({ name: "cancel-route" });

const CANCEL_LATENCY_MS = 800; // artificial latency for legibility
const CANCEL_CONFIRMATION_ID = "CANCEL-88231";

const cancelBodySchema = z.object({ merchant: z.string().min(1) });

export const cancelRouter = Router();

cancelRouter.post("/cancel", async (req: Request, res: Response) => {
  const parsed = cancelBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid cancel request", issues: parsed.error.issues });
  }

  await new Promise((resolve) => setTimeout(resolve, CANCEL_LATENCY_MS));

  const cancelled_at = new Date().toISOString();
  logger.info({ merchant: parsed.data.merchant }, "mock subscription cancelled");
  return res.status(200).json({ confirmation_id: CANCEL_CONFIRMATION_ID, cancelled_at });
});
