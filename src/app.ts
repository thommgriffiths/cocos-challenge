import express from "express";
import type { Pool } from "pg";
import { sendHttpError } from "./http-error.ts";
import { instrumentsRouter } from "./instruments/routes.ts";
import { ordersRouter } from "./orders/routes.ts";
import { portfolioRouter } from "./portfolio/routes.ts";

export function createApp(pool: Pool) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({
        code: "DATABASE_UNAVAILABLE",
        message: "PostgreSQL no está disponible.",
      });
    }
  });

  app.use(ordersRouter(pool));
  app.use(portfolioRouter(pool));
  app.use(instrumentsRouter(pool));
  app.use(sendHttpError);

  return app;
}
