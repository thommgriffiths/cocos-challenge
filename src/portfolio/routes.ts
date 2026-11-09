import express from "express";
import type { Pool } from "pg";
import { parsePathId } from "../http-input.ts";
import { readPortfolio } from "./service.ts";

export function portfolioRouter(pool: Pool) {
  const router = express.Router();
  router.get("/users/:userId/portfolio", async (request, response) => {
    const userId = parsePathId(request.params.userId, "userId");
    response.json(await readPortfolio(pool, userId));
  });
  return router;
}
