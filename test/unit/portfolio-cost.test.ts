import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTrade, type CostState } from "../../src/portfolio/cost.ts";

const empty = { shares: 0n, averageCents: null };

function trade(
  state: CostState,
  side: "BUY" | "SELL",
  size: number,
  price_cents: string,
) {
  return applyTrade(state, { side, size, price_cents });
}

test("weights buy prices by executed size without rounding costs to cents", () => {
  const first = trade(empty, "BUY", 2, "100");
  const second = trade(first, "BUY", 1, "150");
  assert.equal(second.shares, 3n);
  assert.equal(second.averageCents?.toFixed(8), "116.66666667");
  assert.equal(first.averageCents?.toString(), "100");
});

test("a partial sell reduces shares while preserving their average unit cost", () => {
  const opened = trade(trade(empty, "BUY", 10, "10000"), "BUY", 10, "20000");
  const remaining = trade(opened, "SELL", 10, "18000");
  assert.equal(remaining.shares, 10n);
  assert.equal(remaining.averageCents?.toString(), "15000");
});

test("closing a position discards its basis before a later reopening", () => {
  const opened = trade(empty, "BUY", 3, "1200");
  const closed = trade(opened, "SELL", 3, "1700");
  assert.deepEqual(closed, empty);

  const reopened = trade(closed, "BUY", 2, "2200");
  assert.equal(reopened.shares, 2n);
  assert.equal(reopened.averageCents?.toString(), "2200");
});

test("a historical negative position has no long basis until a buy crosses zero", () => {
  const short = trade(trade(empty, "BUY", 2, "1000"), "SELL", 7, "1800");
  assert.deepEqual(short, { shares: -5n, averageCents: null });
  assert.deepEqual(trade(short, "BUY", 2, "2000"), {
    shares: -3n,
    averageCents: null,
  });
  assert.deepEqual(trade(short, "BUY", 5, "2300"), empty);

  const recovered = trade(short, "BUY", 7, "2500");
  assert.equal(recovered.shares, 2n);
  assert.equal(recovered.averageCents?.toString(), "2500");
});
