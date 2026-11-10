import type { Decimal } from "decimal.js";
import type { PoolClient } from "pg";
import { ReturnDecimal } from "./returns.ts";

type Execution = {
  side: "BUY" | "SELL";
  size: number;
  price_cents: string;
};

type Trade = Execution & { instrumentid: number };

export type CostState = { shares: bigint; averageCents: Decimal | null };

export function applyTrade(state: CostState, trade: Execution): CostState {
  const units = BigInt(trade.size);
  const shares = state.shares + (trade.side === "BUY" ? units : -units);
  if (shares <= 0n) return { shares, averageCents: null };
  if (trade.side === "SELL")
    return { shares, averageCents: state.averageCents };

  const price = new ReturnDecimal(trade.price_cents);
  if (state.averageCents === null) return { shares, averageCents: price };

  const averageCents = state.averageCents
    .times(state.shares.toString())
    .plus(price.times(trade.size))
    .div(shares.toString());
  return { shares, averageCents };
}

export async function readAverageCosts(
  client: PoolClient,
  userId: number,
  instrumentIds: number[],
) {
  const costs = new Map<number, CostState>();
  if (instrumentIds.length === 0) return costs;

  await client.query(
    `DECLARE portfolio_history NO SCROLL CURSOR FOR
     SELECT instrumentid, side, size, (price * 100)::bigint::text AS price_cents
     FROM orders
     WHERE userid = $1 AND instrumentid = ANY($2::int[])
       AND status = 'FILLED' AND side IN ('BUY', 'SELL')
     ORDER BY datetime ASC, id ASC`,
    [userId, instrumentIds],
  );

  while (true) {
    const { rows } = await client.query<Trade>(
      "FETCH FORWARD 256 FROM portfolio_history",
    );
    if (rows.length === 0) break;
    for (const trade of rows) {
      const state = costs.get(trade.instrumentid) ?? {
        shares: 0n,
        averageCents: null,
      };
      costs.set(trade.instrumentid, applyTrade(state, trade));
    }
  }

  await client.query("CLOSE portfolio_history");
  return costs;
}
