import type { Pool } from "pg";
import { tradableInstrument } from "../catalog.ts";

export type InstrumentSearch = {
  ticker: string | null;
  name: string | null;
  limit: number;
  offset: number;
};

type Instrument = {
  id: number;
  ticker: string | null;
  name: string | null;
  type: string;
};

function literalPattern(term: string | null) {
  return term === null ? null : `%${term.replace(/[!%_]/g, "!$&")}%`;
}

export async function searchInstruments(pool: Pool, query: InstrumentSearch) {
  const { ticker, name, limit, offset } = query;
  const { rows } = await pool.query<Instrument>(
    `SELECT i.id, i.ticker, i.name, i.type
     FROM instruments AS i
     WHERE ${tradableInstrument}
       AND ($1::text IS NULL OR i.ticker ILIKE $1 ESCAPE '!')
       AND ($2::text IS NULL OR i.name ILIKE $2 ESCAPE '!')
     ORDER BY i.ticker ASC NULLS LAST, i.id ASC
     LIMIT $3 OFFSET $4`,
    [literalPattern(ticker), literalPattern(name), limit, offset],
  );
  return { items: rows, limit, offset };
}
