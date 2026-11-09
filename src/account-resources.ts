import type { PoolClient } from "pg";
import { tradableInstrument } from "./catalog.ts";
import { AppError } from "./errors.ts";

type ResourceRow = {
  instrumentid: number | null;
  invalid: boolean;
  cash_cents: string;
  reserved_cash_cents: string;
  shares: string;
  reserved_shares: string;
};

export async function readAccountResources(client: PoolClient, userId: number) {
  const { rows } = await client.query<ResourceRow>(
    `WITH movements AS (
       SELECT o.instrumentid, o.status, o.side, o.size::numeric AS size, o.price,
              o.size > 0 AND CASE
                WHEN o.status = 'FILLED' AND o.side IN ('CASH_IN', 'CASH_OUT')
                  THEN i.ticker = 'ARS' AND i.type = 'MONEDA'
                WHEN o.status = 'FILLED' AND o.side IN ('BUY', 'SELL')
                  THEN ${tradableInstrument} AND o.price > 0 AND o.price < 'Infinity'::numeric
                WHEN o.status = 'NEW' AND o.side IN ('BUY', 'SELL')
                  THEN ${tradableInstrument} AND o.type = 'LIMIT'
                       AND o.price > 0 AND o.price < 'Infinity'::numeric
                ELSE false
              END AS valid
       FROM orders AS o
       LEFT JOIN instruments AS i ON i.id = o.instrumentid
       WHERE o.userid = $1
         AND o.status IS DISTINCT FROM 'CANCELLED'
         AND o.status IS DISTINCT FROM 'REJECTED'
     )
     SELECT instrumentid, bool_or(valid IS NOT TRUE) AS invalid,
            trunc(100 * sum(CASE WHEN status = 'FILLED' THEN CASE side
              WHEN 'CASH_IN' THEN size
              WHEN 'CASH_OUT' THEN -size
              WHEN 'BUY' THEN -(size * price)
              WHEN 'SELL' THEN size * price
              ELSE 0 END ELSE 0 END))::text AS cash_cents,
            trunc(100 * sum(CASE WHEN status = 'NEW' AND side = 'BUY'
              THEN size * price ELSE 0 END))::text AS reserved_cash_cents,
            sum(CASE WHEN status = 'FILLED' THEN CASE side
              WHEN 'BUY' THEN size WHEN 'SELL' THEN -size ELSE 0 END
              ELSE 0 END)::text AS shares,
            sum(CASE WHEN status = 'NEW' AND side = 'SELL'
              THEN size ELSE 0 END)::text AS reserved_shares
     FROM movements
     GROUP BY instrumentid`,
    [userId],
  );

  let cashCents = 0n;
  let reservedCashCents = 0n;
  const positions = new Map<
    number,
    { shares: bigint; reservedShares: bigint }
  >();
  for (const row of rows) {
    if (row.invalid || row.instrumentid === null) {
      throw new AppError(
        "DATA_INTEGRITY",
        "La cuenta contiene movimientos inválidos.",
      );
    }
    cashCents += BigInt(row.cash_cents);
    reservedCashCents += BigInt(row.reserved_cash_cents);
    const shares = BigInt(row.shares);
    const reservedShares = BigInt(row.reserved_shares);
    if (shares !== 0n || reservedShares !== 0n) {
      positions.set(row.instrumentid, { shares, reservedShares });
    }
  }
  return { cashCents, reservedCashCents, positions };
}
