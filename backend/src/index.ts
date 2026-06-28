import express from "express";
import cors from "cors";
import pino from "pino";
import { config } from "./config.js";
import { investRouter } from "./merchant/invest-route.js";
import { cancelRouter } from "./merchant/cancel-route.js";
import { stateRouter, demoRouter, approvalsRouter } from "./state/state-routes.js";
import { startPortfolioPolling } from "./state/portfolio.js";
import { startSettlementPolling } from "./orchestrator/settlement.js";

const logger = pino({
  level: "info",
});

const app = express();

app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(express.json());

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/invest", investRouter);
app.use("/api/merchant", cancelRouter);
app.use("/api/state", stateRouter);
app.use("/api/demo", demoRouter);
app.use("/api/approvals", approvalsRouter);

// Start background polling loops
startPortfolioPolling();
startSettlementPolling();

app.listen(config.PORT, () => {
  logger.info(`Server started on port ${config.PORT}`);
});

