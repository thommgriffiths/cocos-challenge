import express from "express";
import type { Pool } from "pg";
import { parseOrderInput, parsePathId } from "./input.ts";
import { cancelOrder, submitOrder } from "./service.ts";

export function ordersRouter(pool: Pool) {
  const router = express.Router();

  router.post(
    "/users/:userId/orders",
    express.json({ limit: "16kb" }),
    async (request, response) => {
      const userId = parsePathId(request.params.userId, "userId");
      const input = parseOrderInput(request.body);
      const order = await submitOrder(pool, userId, input);
      response.status(201).json(order);
    },
  );

  router.post(
    "/users/:userId/orders/:orderId/cancel",
    async (request, response) => {
      const userId = parsePathId(request.params.userId, "userId");
      const orderId = parsePathId(request.params.orderId, "orderId");
      response.json(await cancelOrder(pool, userId, orderId));
    },
  );

  return router;
}
