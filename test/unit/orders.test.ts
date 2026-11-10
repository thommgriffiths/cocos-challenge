import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePathId } from "../../src/http-input.ts";
import { decideOrder, orderSize } from "../../src/orders/decision.ts";
import { parseOrderInput } from "../../src/orders/input.ts";

const market = { instrumentId: 47, side: "BUY", type: "MARKET", size: 1 };
const limit = { ...market, type: "LIMIT", price: "30.00" };
const invalidRequest = { code: "INVALID_REQUEST" };

test("validates path IDs and numeric order IDs at the signed integer limits", () => {
  assert.equal(parsePathId("1", "userId"), 1);
  assert.equal(parsePathId("2147483647", "orderId"), 2_147_483_647);
  assert.equal(
    parseOrderInput({ ...market, instrumentId: 2_147_483_647 }).instrumentId,
    2_147_483_647,
  );

  for (const id of ["0", "-1", "2147483648", "2e3", " 1", "1.5", ""]) {
    assert.throws(
      () => parsePathId(id, "userId"),
      invalidRequest,
      JSON.stringify(id),
    );
  }
  for (const id of [0, -1, 2_147_483_648, 1.5, "47", null]) {
    assert.throws(
      () => parseOrderInput({ ...market, instrumentId: id }),
      invalidRequest,
      JSON.stringify(id),
    );
  }
});

test("requires a valid side and type and exactly one quantity representation", () => {
  assert.deepEqual(parseOrderInput({ ...market, size: 2_147_483_647 }), {
    instrumentId: 47,
    side: "BUY",
    pricing: { type: "MARKET" },
    quantity: { size: 2_147_483_647 },
  });
  assert.deepEqual(
    parseOrderInput({
      instrumentId: 47,
      side: "SELL",
      type: "LIMIT",
      price: "30",
      amount: "100",
    }),
    {
      instrumentId: 47,
      side: "SELL",
      pricing: { type: "LIMIT", cents: 3_000n },
      quantity: { amountCents: 10_000n },
    },
  );

  for (const input of [
    null,
    [],
    1,
    { ...market, side: "CASH_IN" },
    { ...market, side: "CASH_OUT" },
    { ...market, side: "buy" },
    { ...market, type: "STOP" },
    { instrumentId: 47, side: "BUY", type: "MARKET" },
    { ...market, amount: "100" },
    { ...market, amount: null },
    ...[0, -1, 1.5, 2_147_483_648, "1", null].map((size) => ({
      ...market,
      size,
    })),
  ]) {
    assert.throws(
      () => parseOrderInput(input),
      invalidRequest,
      JSON.stringify(input),
    );
  }
});

test("enforces decimal syntax and limits only where the price or amount applies", () => {
  assert.deepEqual(
    parseOrderInput({ ...market, price: { ignored: true } }).pricing,
    { type: "MARKET" },
  );
  const maximum = parseOrderInput({
    instrumentId: 47,
    side: "BUY",
    type: "LIMIT",
    price: "99999999.99",
    amount: "999999999999999999.99",
  });
  assert.deepEqual(maximum.pricing, { type: "LIMIT", cents: 9_999_999_999n });
  assert.deepEqual(maximum.quantity, {
    amountCents: 99_999_999_999_999_999_999n,
  });

  for (const value of [
    undefined,
    null,
    10,
    "",
    "0.00",
    "-1",
    "+1",
    " 1",
    "1\n",
    "1e2",
    "1.001",
  ]) {
    assert.throws(
      () => parseOrderInput({ ...limit, price: value }),
      invalidRequest,
      String(value),
    );
    assert.throws(
      () =>
        parseOrderInput({
          instrumentId: 47,
          side: "BUY",
          type: "MARKET",
          amount: value,
        }),
      invalidRequest,
      String(value),
    );
  }
  assert.throws(
    () => parseOrderInput({ ...limit, price: "100000000.00" }),
    invalidRequest,
  );
  assert.throws(
    () =>
      parseOrderInput({
        instrumentId: 47,
        side: "BUY",
        type: "MARKET",
        amount: "1000000000000000000.00",
      }),
    invalidRequest,
  );
});

test("derives the integer share count from exact cents or preserves an explicit size", () => {
  assert.equal(orderSize({ size: 7 }, 30n), 7);
  assert.equal(orderSize({ amountCents: 30n }, 10n), 3);
  assert.equal(orderSize({ amountCents: 10_000n }, 3_000n), 3);
  assert.equal(orderSize({ amountCents: 6_099n }, 3_000n), 2);
});

test("rejects an amount below one share or above the signed integer size limit", () => {
  assert.equal(orderSize({ amountCents: 100n }, 100n), 1);
  assert.equal(orderSize({ amountCents: 2_147_483_647n }, 1n), 2_147_483_647);
  assert.throws(() => orderSize({ amountCents: 99n }, 100n), invalidRequest);
  assert.throws(
    () => orderSize({ amountCents: 2_147_483_648n }, 1n),
    invalidRequest,
  );
});

test("BUY compares effective spend against unreserved cash and chooses the initial status", () => {
  const order = {
    side: "BUY",
    type: "MARKET",
    size: 3,
    priceCents: 3_000n,
  } as const;
  assert.deepEqual(
    decideOrder(order, { cashCents: 9_500n, reservedCashCents: 0n }),
    { status: "FILLED" },
  );
  assert.deepEqual(
    decideOrder(
      { ...order, type: "LIMIT" },
      { cashCents: 10_000n, reservedCashCents: 1_000n },
    ),
    { status: "NEW" },
  );

  for (const type of ["MARKET", "LIMIT"] as const) {
    for (const cashCents of [9_999n, -1n]) {
      assert.deepEqual(
        decideOrder(
          { ...order, type },
          { cashCents, reservedCashCents: 1_000n },
        ),
        { status: "REJECTED", rejectionReason: "INSUFFICIENT_CASH" },
        `${type} with ${cashCents} cents before reservations`,
      );
    }
  }
});

test("SELL compares units against unreserved shares independently of cash", () => {
  const order = {
    side: "SELL",
    type: "MARKET",
    size: 3,
    priceCents: 3_000n,
  } as const;
  const account = {
    cashCents: -1n,
    reservedCashCents: 0n,
    position: { shares: 5n, reservedShares: 2n },
  };
  assert.deepEqual(decideOrder(order, account), { status: "FILLED" });
  assert.deepEqual(decideOrder({ ...order, type: "LIMIT" }, account), {
    status: "NEW",
  });

  for (const type of ["MARKET", "LIMIT"] as const) {
    for (const position of [
      { shares: 4n, reservedShares: 2n },
      { shares: -10n, reservedShares: 0n },
      undefined,
    ]) {
      assert.deepEqual(
        decideOrder({ ...order, type }, { ...account, position }),
        { status: "REJECTED", rejectionReason: "INSUFFICIENT_SHARES" },
        `${type} with ${position?.shares ?? 0n} shares before reservations`,
      );
    }
  }
});
