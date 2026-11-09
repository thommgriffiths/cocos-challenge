import type { Pool, PoolClient } from "pg";
import { readAccountResources } from "../account-resources.ts";
import { tradableInstrument } from "../catalog.ts";
import { AppError, invalidRequest } from "../errors.ts";
import { formatCents } from "../money.ts";
import { withLockedAccount } from "./account-transaction.ts";
import { maxSize, type OrderInput } from "./input.ts";

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

  const quote = await client.query<{ cents: string | null }>(
    `SELECT CASE WHEN isfinite(date) AND close > 0 AND close < 'Infinity'::numeric
                 THEN (close * 100)::bigint::text END AS cents
     FROM marketdata WHERE instrumentid = $1
     ORDER BY date DESC NULLS LAST, id DESC LIMIT 1`,
    [input.instrumentId],
  );
  const cents = quote.rows[0]?.cents;
  if (!cents) {
    throw new AppError(
      "QUOTE_UNAVAILABLE",
      "El instrumento no tiene un cierre válido.",
    );
  }
  return BigInt(cents);
}

function orderSize(quantity: OrderInput["quantity"], priceCents: bigint) {
  if ("size" in quantity) {
    return quantity.size;
  }
  const size = quantity.amountCents / priceCents;
  if (size < 1n || size > BigInt(maxSize)) {
    throw invalidRequest(
      "El monto produce una cantidad de acciones fuera del rango permitido.",
    );
  }
  return Number(size);
}

export function submitOrder(pool: Pool, userId: number, input: OrderInput) {
  return withLockedAccount(pool, userId, async (client) => {
    const {
      instrumentId,
      side,
      pricing: { type },
    } = input;
    const priceCents = await applicablePrice(client, input);
    const size = orderSize(input.quantity, priceCents);
    const units = BigInt(size);
    const { cashCents, reservedCashCents, positions } =
      await readAccountResources(client, userId);
    const position = positions.get(instrumentId);
    const availableShares =
      (position?.shares ?? 0n) - (position?.reservedShares ?? 0n);

    let rejectionReason:
      "INSUFFICIENT_CASH" | "INSUFFICIENT_SHARES" | undefined;
    if (side === "BUY" && units * priceCents > cashCents - reservedCashCents) {
      rejectionReason = "INSUFFICIENT_CASH";
    }
    if (side === "SELL" && units > availableShares) {
      rejectionReason = "INSUFFICIENT_SHARES";
    }

    const status = rejectionReason
      ? "REJECTED"
      : type === "MARKET"
        ? "FILLED"
        : "NEW";
    const price = formatCents(priceCents);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO orders (userid, instrumentid, size, price, side, type, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp() AT TIME ZONE 'UTC')
       RETURNING id`,
      [userId, instrumentId, size, price, side, type, status],
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
      status,
      ...(rejectionReason ? { rejectionReason } : {}),
    };
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
