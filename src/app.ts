import express from "express";
import type { Pool } from "pg";

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

  return app;
}
