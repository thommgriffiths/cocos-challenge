import type { PoolClient } from "pg";

type QuoteRow = {
  id: number;
  ticker: string | null;
  close_cents: string | null;
  previous_close_cents: string | null;
};

export type LatestQuote = {
  instrumentId: number;
  ticker: string | null;
  closeCents: bigint | null;
  previousCloseCents: bigint | null;
};

export async function readLatestQuotes(
  client: PoolClient,
  instrumentIds: number[],
): Promise<LatestQuote[]> {
  if (instrumentIds.length === 0) return [];

  const { rows } = await client.query<QuoteRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (instrumentid) instrumentid, date, close, previousclose
       FROM marketdata
       WHERE instrumentid = ANY($1::int[])
       ORDER BY instrumentid, date DESC NULLS LAST, id DESC
     )
     SELECT i.id, i.ticker,
            CASE WHEN isfinite(latest.date) AND latest.close > 0 AND latest.close < 'Infinity'::numeric
                 THEN (latest.close * 100)::bigint::text END AS close_cents,
            CASE WHEN latest.previousclose > 0 AND latest.previousclose < 'Infinity'::numeric
                 THEN (latest.previousclose * 100)::bigint::text END AS previous_close_cents
     FROM instruments AS i
     LEFT JOIN latest ON latest.instrumentid = i.id
     WHERE i.id = ANY($1::int[])
     ORDER BY i.ticker ASC NULLS LAST, i.id ASC`,
    [instrumentIds],
  );

  return rows.map((row) => ({
    instrumentId: row.id,
    ticker: row.ticker,
    closeCents: row.close_cents === null ? null : BigInt(row.close_cents),
    previousCloseCents:
      row.previous_close_cents === null
        ? null
        : BigInt(row.previous_close_cents),
  }));
}
