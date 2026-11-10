import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { withTestDatabase } from "./database.ts";
import { withTestApi } from "./http.ts";

const fixtures = await readFile(
  new URL("./portfolio-fixtures.sql", import.meta.url),
  "utf8",
);

async function getPortfolio(baseUrl: string, user: number | string) {
  const response = await fetch(`${baseUrl}/users/${user}/portfolio`, {
    signal: AbortSignal.timeout(8_000),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function withPortfolioApi(
  run: (pool: Pool, baseUrl: string) => Promise<void>,
) {
  await withTestDatabase(async (pool) => {
    await pool.query(fixtures);
    await withTestApi(pool, (baseUrl) => run(pool, baseUrl));
  });
}

const book = {
  userId: 2,
  cash: "8090.00",
  availableCash: "7890.00",
  totalValue: "10130.00",
  positions: [
    {
      instrumentId: 2,
      ticker: "ALFA",
      quantity: 10,
      marketValue: "1800.00",
      positionReturnPct: "20.00",
      dailyReturnPct: "20.00",
      historicalNegative: false,
    },
    {
      instrumentId: 4,
      ticker: "NEG",
      quantity: -3,
      marketValue: "-90.00",
      positionReturnPct: null,
      dailyReturnPct: "20.00",
      historicalNegative: true,
    },
    {
      instrumentId: 5,
      ticker: "RECOVER",
      quantity: 2,
      marketValue: "60.00",
      positionReturnPct: "20.00",
      dailyReturnPct: "50.00",
      historicalNegative: false,
    },
    {
      instrumentId: 3,
      ticker: "REOPEN",
      quantity: 3,
      marketValue: "270.00",
      positionReturnPct: "50.00",
      dailyReturnPct: null,
      historicalNegative: false,
    },
  ],
};

test("values executed positions in chronological order and subtracts only cash reservations", async () => {
  await withPortfolioApi(async (_pool, baseUrl) => {
    assert.deepEqual(await getPortfolio(baseUrl, 2), {
      status: 200,
      body: book,
    });
    assert.deepEqual(await getPortfolio(baseUrl, 1), {
      status: 200,
      body: {
        userId: 1,
        cash: "100.00",
        availableCash: "100.00",
        totalValue: "100.00",
        positions: [],
      },
    });
    assert.partialDeepStrictEqual(await getPortfolio(baseUrl, 6), {
      status: 200,
      body: { cash: "-10.00", availableCash: "-20.00", totalValue: "170.00" },
    });
  });
});

test("an absent or invalid latest close preserves quantities and makes total value unknown", async () => {
  await withPortfolioApi(async (_pool, baseUrl) => {
    assert.deepEqual(await getPortfolio(baseUrl, 3), {
      status: 200,
      body: {
        userId: 3,
        cash: "955.00",
        availableCash: "955.00",
        totalValue: null,
        positions: [
          {
            instrumentId: 11,
            ticker: "NOQUOTE",
            quantity: 3,
            marketValue: null,
            positionReturnPct: null,
            dailyReturnPct: null,
            historicalNegative: false,
          },
          {
            instrumentId: 7,
            ticker: "STALE",
            quantity: 2,
            marketValue: null,
            positionReturnPct: null,
            dailyReturnPct: null,
            historicalNegative: false,
          },
          {
            instrumentId: 10,
            ticker: null,
            quantity: 1,
            marketValue: "15.00",
            positionReturnPct: "50.00",
            dailyReturnPct: null,
            historicalNegative: false,
          },
        ],
      },
    });
  });
});

test("handles empty and unknown accounts and rejects invalid path IDs", async () => {
  await withPortfolioApi(async (_pool, baseUrl) => {
    assert.deepEqual(await getPortfolio(baseUrl, 4), {
      status: 200,
      body: {
        userId: 4,
        cash: "0.00",
        availableCash: "0.00",
        totalValue: "0.00",
        positions: [],
      },
    });
    assert.partialDeepStrictEqual(await getPortfolio(baseUrl, 99), {
      status: 404,
      body: { code: "USER_NOT_FOUND" },
    });
    assert.partialDeepStrictEqual(await getPortfolio(baseUrl, "2147483648"), {
      status: 400,
      body: { code: "INVALID_REQUEST" },
    });
  });
});

test("an executed trade with an unusable time fails even if its position is closed", async () => {
  await withPortfolioApi(async (pool, baseUrl) => {
    for (const datetime of [null, "infinity"]) {
      await pool.query(
        "UPDATE orders SET datetime = $1 WHERE userid = 2 AND instrumentid = 6",
        [datetime],
      );
      assert.partialDeepStrictEqual(await getPortfolio(baseUrl, 2), {
        status: 500,
        body: { code: "DATA_INTEGRITY" },
      });
    }
  });
});

test("retains weighted costs across cursor batches and rounds percentage ties half up", async () => {
  await withPortfolioApi(async (pool, baseUrl) => {
    await pool.query(`
      INSERT INTO orders (userid, instrumentid, size, price, side, type, status, datetime)
      SELECT 5, 8, 1, CASE WHEN n <= 256 THEN 100 ELSE 200 END,
             'BUY', 'MARKET', 'FILLED', timestamp '2023-07-13 09:00:00' + (n / 2) * interval '1 microsecond'
      FROM generate_series(1, 260) AS n ORDER BY n
    `);
    assert.deepEqual(await getPortfolio(baseUrl, 5), {
      status: 200,
      body: {
        userId: 5,
        cash: "-26600.00",
        availableCash: "-26600.00",
        totalValue: "-402.01",
        positions: [
          {
            instrumentId: 8,
            ticker: "BATCH",
            quantity: 260,
            marketValue: "26000.00",
            positionReturnPct: "-1.52",
            dailyReturnPct: "0.00",
            historicalNegative: false,
          },
          {
            instrumentId: 9,
            ticker: "ROUND",
            quantity: 1,
            marketValue: "197.99",
            positionReturnPct: "-1.01",
            dailyReturnPct: "-1.01",
            historicalNegative: false,
          },
        ],
      },
    });
  });
});

async function waitForQuoteRead(pool: Pool) {
  const deadline = performance.now() + 3_500;
  while (performance.now() < deadline) {
    const { rows } = await pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%FROM marketdata%'
      ) AS waiting
    `);
    if (rows[0]?.waiting) return;
    await delay(15);
  }
  assert.fail("El portfolio no llegó a la espera de cotizaciones.");
}

test("portfolio uses one snapshot when a trade commits during valuation", async () => {
  await withPortfolioApi(async (pool, baseUrl) => {
    const writer = await pool.connect();
    let pending: Promise<
      PromiseSettledResult<Awaited<ReturnType<typeof getPortfolio>>>[]
    >;
    try {
      await writer.query("BEGIN");
      await writer.query("LOCK TABLE marketdata IN ACCESS EXCLUSIVE MODE");
      pending = Promise.allSettled([getPortfolio(baseUrl, 2)]);
      await waitForQuoteRead(pool);
      await writer.query(`
        INSERT INTO orders (userid, instrumentid, size, price, side, type, status, datetime)
        VALUES (2, 2, 2, 240, 'BUY', 'MARKET', 'FILLED', '2023-07-14 10:00:00')
      `);
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK");
      throw error;
    } finally {
      writer.release();
    }

    const [first] = await pending;
    assert.equal(first?.status, "fulfilled");
    assert.deepEqual(first.value, { status: 200, body: book });
    assert.deepEqual(await getPortfolio(baseUrl, 2), {
      status: 200,
      body: {
        ...book,
        cash: "7610.00",
        availableCash: "7410.00",
        totalValue: "10010.00",
        positions: [
          {
            ...book.positions[0],
            quantity: 12,
            marketValue: "2160.00",
            positionReturnPct: "9.09",
          },
          ...book.positions.slice(1),
        ],
      },
    });
  });
});
