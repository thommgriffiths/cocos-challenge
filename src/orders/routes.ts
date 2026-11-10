import express from "express";
import type { Pool } from "pg";
import { parsePathId } from "../http-input.ts";
import { parseIdempotencyKey, parseOrderInput } from "./input.ts";
import { cancelOrder, submitOrder } from "./service.ts";

export function ordersRouter(pool: Pool) {
  const router = express.Router();

  router.post(
    "/users/:userId/orders",
    express.json({ limit: "16kb" }),
    async (request, response) => {
      const userId = parsePathId(request.params.userId, "userId");
      const input = parseOrderInput(request.body);
      const key = parseIdempotencyKey(
        request.headersDistinct["idempotency-key"],
      );
      const order = await submitOrder(pool, userId, input, key);
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
