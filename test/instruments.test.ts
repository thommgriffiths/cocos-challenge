import assert from "node:assert/strict";
import { test } from "node:test";
import { withTestDatabase } from "./database.ts";
import { withTestApi } from "./http.ts";
import { assertDocumentedResponse } from "./openapi.ts";

async function withCatalog(run: (baseUrl: string) => Promise<void>) {
  await withTestDatabase(async (pool) => {
    await pool.query(`
      INSERT INTO instruments (ticker, name, type) VALUES
        ('ZETA', 'Zeta Holding', 'ACCIONES'),
        ('DUP', 'Primero Holding', 'ACCIONES'),
        ('DUP', 'Doble Holding', 'ACCIONES'),
        (NULL, 'Sin ticker Holding', 'ACCIONES'),
        ('ARS', 'Pesos Holding', 'MONEDA'),
        ('BLANK', 'Tipo vacío Holding', '  '),
        ('UNSET', 'Tipo nulo Holding', NULL),
        ('PAMP', 'Pampa Holding S.A.', 'ACCIONES'),
        ('L%_!', 'Literal %_!' || chr(92) || ' Activo', 'ACCIONES'),
        ('LABC', 'Literal ABC Activo', 'ACCIONES'),
        ('BOND', 'Bono Holding', 'BONOS'),
        ('ACENT', 'Águila Norte', 'ACCIONES'),
        ('UNNAMED', NULL, 'ACCIONES'),
        ('PLAIN', 'Aguila Norte', 'ACCIONES');

      INSERT INTO instruments (ticker, name, type)
      SELECT 'BULK' || lpad(n::text, 3, '0'), 'Paginable', 'ACCIONES'
      FROM generate_series(1, 105) AS n ORDER BY n;
    `);
    await withTestApi(pool, run);
  });
}

async function get(baseUrl: string, params: string | Record<string, string>) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${baseUrl}/instruments?${query}`, {
    signal: AbortSignal.timeout(4_000),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

function itemIds(reply: Awaited<ReturnType<typeof get>>) {
  assert.equal(reply.status, 200);
  assert.ok(
    reply.body && typeof reply.body === "object" && "items" in reply.body,
  );
  assert.ok(Array.isArray(reply.body.items));
  return reply.body.items.map((item) => item.id as number);
}

test("searches ticker and name case-insensitively and combines filters with AND", async () => {
  await withCatalog(async (baseUrl) => {
    const reply = await get(baseUrl, { ticker: "  aMp  " });
    assertDocumentedResponse("get", "/instruments", reply);
    assert.deepEqual(reply, {
      status: 200,
      body: {
        items: [
          {
            id: 8,
            ticker: "PAMP",
            name: "Pampa Holding S.A.",
            type: "ACCIONES",
          },
        ],
        limit: 20,
        offset: 0,
      },
    });
    assert.deepEqual(
      itemIds(await get(baseUrl, { name: " hOLDing " })),
      [11, 2, 3, 8, 1, 4],
    );
    assert.deepEqual(
      itemIds(await get(baseUrl, { ticker: "dup", name: "doble" })),
      [3],
    );
    assert.deepEqual(await get(baseUrl, { ticker: "pamp", name: "doble" }), {
      status: 200,
      body: { items: [], limit: 20, offset: 0 },
    });
    assert.deepEqual(itemIds(await get(baseUrl, { ticker: "UNNAMED" })), [13]);
    assert.deepEqual(itemIds(await get(baseUrl, { name: "águila" })), [12]);
    assert.deepEqual(itemIds(await get(baseUrl, { name: "aguila" })), [14]);
    assert.deepEqual(itemIds(await get(baseUrl, { ticker: "ars" })), []);
  });
});

test("matches literal wildcards, escape characters and SQL-like input", async () => {
  await withCatalog(async (baseUrl) => {
    for (const name of ["%", "_", "!", "\\", " %_!\\ "]) {
      assert.deepEqual(itemIds(await get(baseUrl, { name })), [9]);
    }
    assert.deepEqual(itemIds(await get(baseUrl, { ticker: "%_!" })), [9]);
    assert.deepEqual(itemIds(await get(baseUrl, { name: "' OR 1=1 --" })), []);
  });
});

test("validates missing, blank, repeated and out-of-range parameters", async () => {
  await withCatalog(async (baseUrl) => {
    for (const params of [
      "",
      "limit=10",
      "ticker=",
      "ticker=pamp&name=++",
      "ticker=pamp&ticker=pamp",
      "name=holding&name=doble",
      "ticker=pamp&limit=",
      "ticker=pamp&limit=0",
      "ticker=pamp&limit=101",
      "ticker=pamp&limit=1.5",
      "ticker=pamp&limit=1&limit=2",
      "ticker=pamp&offset=-1",
      "ticker=pamp&offset=100001",
      "ticker=pamp&offset=1e2",
      "ticker=pamp&offset=1&offset=2",
      "name=%00",
      { name: "x".repeat(101) },
      "ticker=pamp&" + "x=&".repeat(1_000) + "ticker=dup",
    ]) {
      assert.partialDeepStrictEqual(await get(baseUrl, params), {
        status: 400,
        body: { code: "INVALID_REQUEST" },
      });
    }
    assert.deepEqual(await get(baseUrl, { name: "😀".repeat(100) }), {
      status: 200,
      body: { items: [], limit: 20, offset: 0 },
    });
    assert.deepEqual(await get(baseUrl, { ticker: "pamp", offset: "100000" }), {
      status: 200,
      body: { items: [], limit: 20, offset: 100000 },
    });
  });
});

test("paginates in stable order with an absolute page size of 100", async () => {
  await withCatalog(async (baseUrl) => {
    assert.deepEqual(
      itemIds(await get(baseUrl, { name: "holding", limit: "1", offset: "2" })),
      [3],
    );
    assert.deepEqual(
      itemIds(await get(baseUrl, { name: "holding", limit: "1", offset: "5" })),
      [4],
    );

    const defaults = await get(baseUrl, { name: "paginable" });
    assert.partialDeepStrictEqual(defaults, {
      status: 200,
      body: { limit: 20, offset: 0 },
    });
    assert.deepEqual(
      itemIds(defaults),
      Array.from({ length: 20 }, (_, index) => 15 + index),
    );

    const first = await get(baseUrl, { ticker: "bulk", limit: "100" });
    assert.partialDeepStrictEqual(first, {
      status: 200,
      body: { limit: 100, offset: 0 },
    });
    assert.deepEqual(
      itemIds(first),
      Array.from({ length: 100 }, (_, index) => 15 + index),
    );
    assert.deepEqual(
      itemIds(
        await get(baseUrl, { ticker: "bulk", limit: "100", offset: "100" }),
      ),
      [115, 116, 117, 118, 119],
    );
    assert.deepEqual(
      await get(baseUrl, { ticker: "bulk", limit: "100", offset: "105" }),
      {
        status: 200,
        body: { items: [], limit: 100, offset: 105 },
      },
    );
  });
});
