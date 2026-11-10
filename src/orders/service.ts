import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { readAccountResources } from "../account-resources.ts";
import { tradableInstrument } from "../catalog.ts";
import { AppError } from "../errors.ts";
import { formatCents } from "../money.ts";
import { readLatestQuotes } from "../quotes.ts";
import { withLockedAccount } from "./account-transaction.ts";
import { decideOrder, orderSize } from "./decision.ts";
import type { OrderInput } from "./input.ts";

async function applicablePrice(client: PoolClient, input: OrderInput) {
  const instrument = await client.query<{ tradable: boolean | null }>(
    `SELECT ${tradableInstrument} AS tradable FROM instruments AS i WHERE i.id = $1`,
    [input.instrumentId],
  );
  const row = instrument.rows[0];
  if (!row) {
    throw new AppError("INSTRUMENT_NOT_FOUND", "El instrumento no existe.");
  }
  if (!row.tradable) {
    throw new AppError(
      "INSTRUMENT_NOT_TRADABLE",
      "El instrumento está fuera del catálogo.",
    );
  }
  if (input.pricing.type === "LIMIT") {
    return input.pricing.cents;
  }

  const [quote] = await readLatestQuotes(client, [input.instrumentId]);
  if (!quote || quote.closeCents === null) {
    throw new AppError(
      "QUOTE_UNAVAILABLE",
      "El instrumento no tiene un cierre válido.",
    );
  }
  return quote.closeCents;
}

async function insertOrder(
  client: PoolClient,
  userId: number,
  input: OrderInput,
) {
  const {
    instrumentId,
    side,
    pricing: { type },
  } = input;
  const priceCents = await applicablePrice(client, input);
  const size = orderSize(input.quantity, priceCents);
  const { cashCents, reservedCashCents, positions } =
    await readAccountResources(client, userId);
  const decision = decideOrder(
    { side, type, size, priceCents },
    { cashCents, reservedCashCents, position: positions.get(instrumentId) },
  );
  const price = formatCents(priceCents);
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO orders (userid, instrumentid, size, price, side, type, status, datetime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp() AT TIME ZONE 'UTC')
     RETURNING id`,
    [userId, instrumentId, size, price, side, type, decision.status],
  );
  const order = inserted.rows[0];
  if (!order) {
    throw new Error("La inserción no devolvió la orden.");
  }
  return {
    id: order.id,
    userId,
    instrumentId,
    side,
    type,
    size,
    price,
    ...decision,
  };
}

function orderFingerprint({
  instrumentId,
  side,
  pricing,
  quantity,
}: OrderInput) {
  // Keep the tuple stable while existing keys can be retried.
  const canonical = JSON.stringify([
    instrumentId,
    side,
    pricing.type,
    pricing.type === "LIMIT" ? pricing.cents.toString() : null,
    "size" in quantity
      ? ["size", quantity.size]
      : ["amount", quantity.amountCents.toString()],
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function submitOrder(
  pool: Pool,
  userId: number,
  input: OrderInput,
  idempotencyKey?: string,
) {
  return withLockedAccount(pool, userId, async (client) => {
    if (idempotencyKey === undefined) return insertOrder(client, userId, input);

    const requestHash = orderFingerprint(input);
    const {
      rows: [saved],
    } = await client.query<{
      request_hash: string;
      response: Awaited<ReturnType<typeof insertOrder>>;
    }>(
      `SELECT request_hash, response FROM order_idempotency
       WHERE userid = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (saved) {
      if (saved.request_hash !== requestHash) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "La clave de idempotencia ya se usó con otra solicitud.",
        );
      }
      return saved.response;
    }

    const order = await insertOrder(client, userId, input);
    await client.query(
      `INSERT INTO order_idempotency (userid, idempotency_key, request_hash, orderid, response)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, idempotencyKey, requestHash, order.id, order],
    );
    return order;
  });
}

export function cancelOrder(pool: Pool, userId: number, orderId: number) {
  return withLockedAccount(pool, userId, async (client) => {
    const result = await client.query(
      `UPDATE orders SET status = 'CANCELLED'
       WHERE id = $1 AND userid = $2 AND status = 'NEW'`,
      [orderId, userId],
    );
    if (result.rowCount === 1) {
      return { id: orderId, status: "CANCELLED" };
    }

    const order = await client.query(
      "SELECT id FROM orders WHERE id = $1 AND userid = $2",
      [orderId, userId],
    );
    if (order.rowCount === 0) {
      throw new AppError(
        "ORDER_NOT_FOUND",
        "La orden no existe para esta cuenta.",
      );
    }
    throw new AppError(
      "ORDER_NOT_CANCELLABLE",
      "Solo se pueden cancelar órdenes NEW.",
    );
  });
}
