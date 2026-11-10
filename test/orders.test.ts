import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { withTestDatabase } from "./database.ts";
import { withTestApi } from "./http.ts";
import { assertDocumentedResponse } from "./openapi.ts";

const fixtures = await readFile(
  new URL("./orders-fixtures.sql", import.meta.url),
  "utf8",
);
const marketBuy = { instrumentId: 2, side: "BUY", type: "MARKET", size: 1 };
const marketSell = { ...marketBuy, side: "SELL" };

async function post(
  baseUrl: string,
  path: string,
  body?: unknown,
  key?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: {
            "content-type": "application/json",
            ...(key === undefined ? {} : { "Idempotency-Key": key }),
          },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(9_000),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

type Reply = Awaited<ReturnType<typeof post>>;
type OrdersApi = {
  pool: Pool;
  baseUrl: string;
  submit: (user: number, body: unknown, key?: string) => Promise<Reply>;
  cancel: (user: number, order: number) => Promise<Reply>;
};

async function withOrdersApi(run: (api: OrdersApi) => Promise<void>) {
  await withTestDatabase(async (pool) => {
    await pool.query(fixtures);
    await withTestApi(pool, async (baseUrl) => {
      await run({
        pool,
        baseUrl,
        submit: (user, body, key) =>
          post(baseUrl, `/users/${user}/orders`, body, key),
        cancel: (user, order) =>
          post(baseUrl, `/users/${user}/orders/${order}/cancel`),
      });
    });
  });
}

function assertProblem(reply: Reply, status: number, code: string) {
  assert.equal(reply.status, status);
  assert.ok(
    reply.body && typeof reply.body === "object" && "code" in reply.body,
  );
  assert.equal(reply.body.code, code);
  assert.ok("message" in reply.body && typeof reply.body.message === "string");
}

function assertCreated(reply: Reply, fields: Record<string, unknown>) {
  assert.partialDeepStrictEqual(reply, { status: 201, body: fields });
  assertDocumentedResponse("post", "/users/{userId}/orders", reply);
}

async function createdRows(pool: Pool) {
  const result = await pool.query(
    "SELECT id, userid, instrumentid, side, type, size, price, status FROM orders WHERE id > 6 ORDER BY id",
  );
  return result.rows;
}

test("MARKET buys and sells at the deterministic latest close and persists UTC time", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    const before = await pool.query<{ now: string }>(
      "SELECT (clock_timestamp() AT TIME ZONE 'UTC')::text AS now",
    );
    const since = before.rows[0]?.now;
    assert.ok(since);

    const buy = await submit(1, { ...marketBuy, size: 2, price: "1.00" });
    assertDocumentedResponse("post", "/users/{userId}/orders", buy);
    assert.deepEqual(buy, {
      status: 201,
      body: {
        id: 7,
        userId: 1,
        instrumentId: 2,
        side: "BUY",
        type: "MARKET",
        size: 2,
        price: "30.00",
        status: "FILLED",
      },
    });
    assert.deepEqual(await submit(1, { ...marketSell, size: 6 }), {
      status: 201,
      body: {
        id: 8,
        userId: 1,
        instrumentId: 2,
        side: "SELL",
        type: "MARKET",
        size: 6,
        price: "30.00",
        status: "FILLED",
      },
    });

    assert.deepEqual(await createdRows(pool), [
      {
        id: 7,
        userid: 1,
        instrumentid: 2,
        side: "BUY",
        type: "MARKET",
        size: 2,
        price: "30.00",
        status: "FILLED",
      },
      {
        id: 8,
        userid: 1,
        instrumentid: 2,
        side: "SELL",
        type: "MARKET",
        size: 6,
        price: "30.00",
        status: "FILLED",
      },
    ]);
    const timestamps = await pool.query(
      "SELECT datetime BETWEEN $1::timestamp AND clock_timestamp() AT TIME ZONE 'UTC' AS valid FROM orders WHERE id > 6 ORDER BY id",
      [since],
    );
    assert.deepEqual(timestamps.rows, [{ valid: true }, { valid: true }]);
  });
});

test("LIMIT reserves cash without execution and works without a market close", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    assertCreated(
      await submit(2, {
        instrumentId: 2,
        side: "BUY",
        type: "LIMIT",
        amount: "100.00",
        price: "31.00",
      }),
      { type: "LIMIT", size: 3, price: "31.00", status: "NEW" },
    );
    assertCreated(
      await submit(2, {
        ...marketBuy,
        instrumentId: 3,
        type: "LIMIT",
        price: "2",
      }),
      { instrumentId: 3, size: 1, price: "2.00", status: "NEW" },
    );
    assertProblem(
      await submit(2, { ...marketBuy, instrumentId: 3 }),
      422,
      "QUOTE_UNAVAILABLE",
    );
    assertCreated(await submit(2, marketBuy), {
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_CASH",
    });
    assert.deepEqual(
      (await createdRows(pool)).map((row) => [row.size, row.price, row.status]),
      [
        [3, "31.00", "NEW"],
        [1, "2.00", "NEW"],
        [1, "30.00", "REJECTED"],
      ],
    );
  });
});

test("pending sells reserve shares but cannot finance a buy", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    assertCreated(
      await submit(3, { ...marketSell, type: "LIMIT", size: 3, price: "20" }),
      { side: "SELL", size: 3, price: "20.00", status: "NEW" },
    );
    assertCreated(await submit(3, marketBuy), {
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_CASH",
    });
    assertCreated(
      await submit(3, {
        instrumentId: 2,
        side: "SELL",
        type: "MARKET",
        amount: "60.99",
      }),
      {
        size: 2,
        price: "30.00",
        status: "REJECTED",
        rejectionReason: "INSUFFICIENT_SHARES",
      },
    );
    assertCreated(await submit(3, marketSell), { size: 1, status: "FILLED" });
    assert.deepEqual(
      (await createdRows(pool)).map((row) => [row.side, row.size, row.status]),
      [
        ["SELL", 3, "NEW"],
        ["BUY", 1, "REJECTED"],
        ["SELL", 2, "REJECTED"],
        ["SELL", 1, "FILLED"],
      ],
    );
  });
});

test("converts amounts in exact cents at integer and price boundaries", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    assertCreated(
      await submit(2, {
        instrumentId: 2,
        side: "BUY",
        type: "MARKET",
        amount: "100.00",
      }),
      { size: 3, price: "30.00", status: "FILLED" },
    );
    assertCreated(
      await submit(4, {
        instrumentId: 2,
        side: "BUY",
        type: "LIMIT",
        amount: "214748364678525163.53",
        price: "99999999.99",
      }),
      {
        size: 2147483647,
        price: "99999999.99",
        status: "REJECTED",
        rejectionReason: "INSUFFICIENT_CASH",
      },
    );
    assertProblem(
      await submit(4, {
        instrumentId: 2,
        side: "BUY",
        type: "LIMIT",
        amount: "21474836.48",
        price: "0.01",
      }),
      400,
      "INVALID_REQUEST",
    );
    assertProblem(
      await submit(4, {
        instrumentId: 2,
        side: "BUY",
        type: "MARKET",
        amount: "0.01",
      }),
      400,
      "INVALID_REQUEST",
    );
    assert.deepEqual(
      (await createdRows(pool)).map((row) => [row.size, row.price, row.status]),
      [
        [3, "30.00", "FILLED"],
        [2147483647, "99999999.99", "REJECTED"],
      ],
    );
  });
});

test("invalid requests, resources and unusable closes leave no order", async () => {
  await withOrdersApi(async ({ pool, baseUrl, submit }) => {
    for (const input of [
      { ...marketBuy, side: "CASH_IN" },
      { ...marketBuy, side: "CASH_OUT" },
      { ...marketBuy, type: "STOP" },
      { ...marketBuy, size: 1.5 },
      { ...marketBuy, size: 0 },
      { ...marketBuy, size: 2147483648 },
      { ...marketBuy, amount: "1.00" },
      { instrumentId: 2, side: "BUY", type: "MARKET" },
      { ...marketBuy, type: "LIMIT" },
      { ...marketBuy, type: "LIMIT", price: "30.001" },
      { ...marketBuy, type: "LIMIT", price: "30.00\n" },
      { ...marketBuy, type: "LIMIT", price: "100000000.00" },
      [],
    ]) {
      assertProblem(await submit(1, input), 400, "INVALID_REQUEST");
    }
    assertProblem(
      await post(baseUrl, "/users/2147483648/orders", marketBuy),
      400,
      "INVALID_REQUEST",
    );
    const malformed = await fetch(`${baseUrl}/users/1/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
      signal: AbortSignal.timeout(3_000),
    });
    assertProblem(
      { status: malformed.status, body: await malformed.json() },
      400,
      "INVALID_REQUEST",
    );
    assertProblem(await submit(99, marketBuy), 404, "USER_NOT_FOUND");
    assertProblem(
      await submit(1, { ...marketBuy, instrumentId: 99 }),
      404,
      "INSTRUMENT_NOT_FOUND",
    );
    assertProblem(
      await submit(1, { ...marketBuy, instrumentId: 1 }),
      422,
      "INSTRUMENT_NOT_TRADABLE",
    );
    for (const instrumentId of [3, 4, 5, 6]) {
      assertProblem(
        await submit(1, { ...marketBuy, instrumentId }),
        422,
        "QUOTE_UNAVAILABLE",
      );
    }
    assert.deepEqual(await createdRows(pool), []);
  });
});

test("invalid active history fails closed while cancelled and rejected rows do not count", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    await pool.query(
      "INSERT INTO orders (userid, status) VALUES (2, 'CANCELLED'), (2, 'REJECTED')",
    );
    assert.equal((await submit(2, marketBuy)).status, 201);
    await pool.query("UPDATE orders SET price = 'NaN' WHERE id = 9");
    assertProblem(await submit(2, marketBuy), 500, "DATA_INTEGRITY");
    await pool.query(
      "UPDATE orders SET price = 30, status = NULL WHERE id = 9",
    );
    assertProblem(await submit(2, marketBuy), 500, "DATA_INTEGRITY");
    assert.equal((await createdRows(pool)).length, 3);
  });
});

test("a deferred failure at COMMIT rolls back the order and idempotency key", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    await pool.query(`
      CREATE FUNCTION fail_order_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END; $$;
      CREATE CONSTRAINT TRIGGER fail_order_commit AFTER INSERT ON orders
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_order_commit();
    `);
    const key = "commit-retry";
    assertProblem(await submit(2, marketBuy, key), 500, "INTERNAL_ERROR");
    assert.deepEqual(await createdRows(pool), []);
    assert.equal(
      (await pool.query("SELECT 1 FROM order_idempotency")).rowCount,
      0,
    );
    await pool.query("DROP TRIGGER fail_order_commit ON orders");
    const retry = { ...marketBuy, size: 3 };
    const reply = await submit(2, retry, key);
    assertCreated(reply, { status: "FILLED", size: 3 });
    assert.deepEqual(await submit(2, retry, key), reply);
    assert.deepEqual(
      (await createdRows(pool)).map((row) => row.status),
      ["FILLED"],
    );
  });
});

async function withAccountBlocked<T>(
  pool: Pool,
  user: number,
  run: () => Promise<T>,
) {
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      user,
    ]);
    return await run();
  } finally {
    try {
      await blocker.query("ROLLBACK");
    } finally {
      blocker.release();
    }
  }
}

async function waitForTwoBlockedRequests(pool: Pool) {
  const deadline = performance.now() + 3_500;
  while (performance.now() < deadline) {
    const result = await pool.query<{ blocked: number }>(`
      SELECT count(*)::int AS blocked FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(pid)) > 0
    `);
    if (result.rows[0]?.blocked === 2) return;
    await delay(15);
  }
  assert.fail("No se observaron dos solicitudes bloqueadas en PostgreSQL.");
}

async function overlap(
  pool: Pool,
  user: number,
  request: () => Promise<Reply>,
) {
  const { responses } = await withAccountBlocked(pool, user, async () => {
    const responses = Promise.allSettled([request(), request()]);
    await waitForTwoBlockedRequests(pool);
    return { responses };
  });
  return (await responses).map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

test("overlapping buys and sells cannot spend or sell the same resources twice", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    const buys = await overlap(pool, 2, () =>
      submit(2, { ...marketBuy, size: 2 }),
    );
    const sells = await overlap(pool, 3, () =>
      submit(3, { ...marketSell, size: 3 }),
    );
    for (const reply of [...buys, ...sells]) assert.equal(reply.status, 201);
    assert.deepEqual(
      (await createdRows(pool)).map((row) => [
        row.userid,
        row.size,
        row.status,
      ]),
      [
        [2, 2, "FILLED"],
        [2, 2, "REJECTED"],
        [3, 3, "FILLED"],
        [3, 3, "REJECTED"],
      ],
    );
  });
});

test("concurrent retries return one MARKET order and preserve the original quote", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    const key = "same-market";
    const body = { ...marketBuy, size: 2 };
    const [first, second] = await overlap(pool, 2, () => submit(2, body, key));
    assert.ok(first);
    assertCreated(first, { id: 7, size: 2, price: "30.00", status: "FILLED" });
    assert.deepEqual(second, first);

    await pool.query("UPDATE marketdata SET close = 'NaN' WHERE id = 3");
    assert.deepEqual(
      await submit(2, { ...body, price: "ignored" }, key),
      first,
    );
    assert.equal((await createdRows(pool)).length, 1);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT userid, orderid, response FROM order_idempotency",
        )
      ).rows,
      [{ userid: 2, orderid: 7, response: first.body }],
    );
  });
});

test("replays a normalized LIMIT after cancellation and scopes conflicts to the account", async () => {
  await withOrdersApi(async ({ pool, submit, cancel }) => {
    const key = "limit-retry";
    const body = {
      instrumentId: 2,
      side: "BUY",
      type: "LIMIT",
      amount: "100.00",
      price: "30.00",
    };
    const created = await submit(2, body, key);
    assertCreated(created, { id: 7, size: 3, status: "NEW" });
    assert.equal((await cancel(2, 7)).status, 200);

    const normalized = {
      amount: "0100.0",
      price: "030",
      side: "BUY",
      type: "LIMIT",
      instrumentId: 2,
    };
    assert.deepEqual(await submit(2, normalized, key), created);
    const conflict = await submit(
      2,
      { ...marketBuy, type: "LIMIT", size: 3, price: "30" },
      key,
    );
    assertProblem(conflict, 409, "IDEMPOTENCY_CONFLICT");
    assertDocumentedResponse("post", "/users/{userId}/orders", conflict);
    assertCreated(await submit(1, marketBuy, key), {
      id: 8,
      userId: 1,
      status: "FILLED",
    });
    assert.deepEqual(
      (await createdRows(pool)).map((row) => row.status),
      ["CANCELLED", "FILLED"],
    );
  });
});

test("replays a persisted rejection after funds change", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    const body = { ...marketBuy, size: 4 };
    const rejected = await submit(2, body, "rejected-order");
    assertCreated(rejected, {
      id: 7,
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_CASH",
    });
    await pool.query(`INSERT INTO orders (userid, instrumentid, size, side, status)
      VALUES (2, 1, 50, 'CASH_IN', 'FILLED')`);
    assert.deepEqual(await submit(2, body, "rejected-order"), rejected);
    assertCreated(await submit(2, body, "new-order"), {
      id: 9,
      status: "FILLED",
    });
    assert.deepEqual(
      (await createdRows(pool)).map((row) => row.status),
      ["REJECTED", "FILLED", "FILLED"],
    );
  });
});

test("rejects invalid or repeated keys and leaves invalid orders free to retry", async () => {
  await withOrdersApi(async ({ pool, baseUrl, submit }) => {
    for (const key of ["", "x".repeat(129), "two keys", "first,second"]) {
      assertProblem(await submit(2, marketBuy, key), 400, "INVALID_REQUEST");
    }

    const body = JSON.stringify(marketBuy);
    const duplicate = await new Promise<Reply>((resolve, reject) => {
      const req = request(
        `${baseUrl}/users/2/orders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
            "Idempotency-Key": ["same", "same"],
          },
          signal: AbortSignal.timeout(4_000),
        },
        async (response) => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of response) chunks.push(Buffer.from(chunk));
            assert.ok(response.statusCode);
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        },
      );
      req.on("error", reject).end(body);
    });
    assertProblem(duplicate, 400, "INVALID_REQUEST");

    const reusableKey = "A".repeat(128);
    assertProblem(
      await submit(2, { ...marketBuy, instrumentId: 3 }, reusableKey),
      422,
      "QUOTE_UNAVAILABLE",
    );
    assert.deepEqual(await createdRows(pool), []);
    assert.equal(
      (await pool.query("SELECT 1 FROM order_idempotency")).rowCount,
      0,
    );
    assertCreated(await submit(2, marketBuy, reusableKey), {
      id: 7,
      status: "FILLED",
    });
  });
});

test("cancellation is scoped to the owner, preserves time and releases a reservation once", async () => {
  await withOrdersApi(async ({ pool, submit, cancel }) => {
    assert.equal(
      (
        await submit(2, {
          ...marketBuy,
          type: "LIMIT",
          size: 3,
          price: "30.00",
        })
      ).status,
      201,
    );
    const timestamp = (
      await pool.query("SELECT datetime::text FROM orders WHERE id = 7")
    ).rows;
    assertProblem(await cancel(1, 7), 404, "ORDER_NOT_FOUND");
    assertProblem(await cancel(1, 2), 409, "ORDER_NOT_CANCELLABLE");

    const replies = await overlap(pool, 2, () => cancel(2, 7));
    const cancelled = replies.find((reply) => reply.status === 200);
    assert.ok(cancelled);
    assertDocumentedResponse(
      "post",
      "/users/{userId}/orders/{orderId}/cancel",
      cancelled,
    );
    assert.deepEqual(cancelled.body, {
      id: 7,
      status: "CANCELLED",
    });
    const conflict = replies.find((reply) => reply.status === 409);
    assert.ok(conflict);
    assertProblem(conflict, 409, "ORDER_NOT_CANCELLABLE");
    assertDocumentedResponse(
      "post",
      "/users/{userId}/orders/{orderId}/cancel",
      conflict,
    );
    assert.deepEqual(
      (await pool.query("SELECT datetime::text FROM orders WHERE id = 7")).rows,
      timestamp,
    );

    assert.equal((await submit(2, { ...marketBuy, size: 3 })).status, 201);
    assert.equal((await submit(2, marketBuy)).status, 201);
    assert.deepEqual(
      (await createdRows(pool)).map((row) => row.status),
      ["CANCELLED", "FILLED", "REJECTED"],
    );
  });
});

test("a timed-out account lock returns 503 without inserting an order", async () => {
  await withOrdersApi(async ({ pool, submit }) => {
    await withAccountBlocked(pool, 2, async () => {
      const reply = await submit(2, marketBuy);
      assertProblem(reply, 503, "ACCOUNT_BUSY");
      assertDocumentedResponse("post", "/users/{userId}/orders", reply);
    });
    assert.deepEqual(await createdRows(pool), []);
    assert.equal((await submit(2, marketBuy)).status, 201);
    assert.deepEqual(
      (await createdRows(pool)).map((row) => row.status),
      ["FILLED"],
    );
  });
});
