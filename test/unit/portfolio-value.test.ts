import assert from "node:assert/strict";
import { test } from "node:test";
import { ReturnDecimal, formatReturn } from "../../src/portfolio/returns.ts";
import { valuePortfolio } from "../../src/portfolio/value.ts";
import type { LatestQuote } from "../../src/quotes.ts";

test("rounds positive and negative percentage ties half up and normalizes negative zero", () => {
  assert.equal(formatReturn(20_201n, 20_000n), "1.01");
  assert.equal(formatReturn(19_799n, 20_000n), "-1.01");
  assert.equal(formatReturn(100_000n, 100_001n), "0.00");
  assert.equal(formatReturn(10_000n, 10_000n), "0.00");
});

const resources = {
  cashCents: 10_000n,
  reservedCashCents: 2_500n,
  positions: new Map([
    [1, { shares: 2n }],
    [2, { shares: -1n }],
  ]),
};
const longQuote: LatestQuote = {
  instrumentId: 1,
  ticker: "LONG",
  closeCents: 39_598n,
  previousCloseCents: 39_599n,
};
const shortQuote: LatestQuote = {
  instrumentId: 2,
  ticker: "SHORT",
  closeCents: 2_000n,
  previousCloseCents: 2_500n,
};
const costs = new Map([
  [1, { shares: 2n, averageCents: new ReturnDecimal("40000") }],
]);

test("values signed positions and reports an unknown total if any close is missing", () => {
  const complete = valuePortfolio(1, resources, [longQuote, shortQuote], costs);
  assert.deepEqual(complete, {
    userId: 1,
    cash: "100.00",
    availableCash: "75.00",
    totalValue: "871.96",
    positions: [
      {
        instrumentId: 1,
        ticker: "LONG",
        quantity: 2,
        marketValue: "791.96",
        positionReturnPct: "-1.01",
        dailyReturnPct: "0.00",
        historicalNegative: false,
      },
      {
        instrumentId: 2,
        ticker: "SHORT",
        quantity: -1,
        marketValue: "-20.00",
        positionReturnPct: null,
        dailyReturnPct: "-20.00",
        historicalNegative: true,
      },
    ],
  });

  const dailyTie = valuePortfolio(
    1,
    resources,
    [{ ...longQuote, previousCloseCents: 40_000n }, shortQuote],
    costs,
  );
  assert.equal(dailyTie.positions[0]?.dailyReturnPct, "-1.01");

  assert.deepEqual(
    valuePortfolio(
      1,
      resources,
      [
        { ...longQuote, closeCents: null },
        { ...shortQuote, previousCloseCents: null },
      ],
      new Map(),
    ),
    {
      userId: 1,
      cash: "100.00",
      availableCash: "75.00",
      totalValue: null,
      positions: [
        {
          instrumentId: 1,
          ticker: "LONG",
          quantity: 2,
          marketValue: null,
          positionReturnPct: null,
          dailyReturnPct: null,
          historicalNegative: false,
        },
        {
          instrumentId: 2,
          ticker: "SHORT",
          quantity: -1,
          marketValue: "-20.00",
          positionReturnPct: null,
          dailyReturnPct: null,
          historicalNegative: true,
        },
      ],
    },
  );
});

test("rejects unsafe JSON quantities and inconsistent cost for a valued long position", () => {
  const unpriced = { ...longQuote, closeCents: null };
  const max = 9_007_199_254_740_991n;
  const withShares = (shares: bigint) => ({
    ...resources,
    positions: new Map([[1, { shares }]]),
  });
  for (const shares of [max, -max]) {
    const result = valuePortfolio(1, withShares(shares), [unpriced], new Map());
    assert.equal(
      result.positions[0]?.quantity,
      shares > 0n ? 9_007_199_254_740_991 : -9_007_199_254_740_991,
    );
  }
  for (const shares of [max + 1n, -max - 1n]) {
    assert.throws(
      () => valuePortfolio(1, withShares(shares), [unpriced], new Map()),
      { code: "DATA_INTEGRITY" },
    );
  }

  assert.throws(() => valuePortfolio(1, resources, [longQuote], new Map()), {
    code: "DATA_INTEGRITY",
  });
  const mismatched = new Map([
    [1, { shares: 1n, averageCents: new ReturnDecimal("40000") }],
  ]);
  assert.throws(() => valuePortfolio(1, resources, [longQuote], mismatched), {
    code: "DATA_INTEGRITY",
  });
});
