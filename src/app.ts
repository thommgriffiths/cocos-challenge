import express from "express";
import type { Pool } from "pg";
import { AppError } from "./errors.ts";
import { checkReadiness } from "./health.ts";
import { sendHttpError } from "./http-error.ts";
import { instrumentsRouter } from "./instruments/routes.ts";
import { docsRouter } from "./openapi.ts";
import { ordersRouter } from "./orders/routes.ts";
import { portfolioRouter } from "./portfolio/routes.ts";

export function createApp(pool: Pool) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    await checkReadiness(pool);
    response.json({ status: "ok" });
  });

  app.use(ordersRouter(pool));
  app.use(portfolioRouter(pool));
  app.use(instrumentsRouter(pool));
  app.use(docsRouter());
  app.use((_request, _response, next) => {
    next(new AppError("ROUTE_NOT_FOUND", "La ruta no existe."));
  });
  app.use(sendHttpError);

  return app;
}
