import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseError, Pool } from "pg";
import { withTestDatabase } from "./database.ts";
import { withTestApi } from "./http.ts";
import { assertDocumentedResponse } from "./openapi.ts";

test("serves readiness over HTTP with PostgreSQL and independent fixtures", async () => {
  await withTestDatabase(async (pool) => {
    const fixture = await pool.query("SELECT accountnumber FROM users");
    assert.deepEqual(fixture.rows, [{ accountnumber: "SMOKE" }]);

    await withTestApi(pool, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body: unknown = await response.json();
      assert.deepEqual(body, { status: "ok" });
      assertDocumentedResponse("get", "/health", {
        status: response.status,
        body,
      });

      await pool.query(
        "ALTER TABLE marketdata RENAME COLUMN close TO archived_close",
      );
      const incomplete = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(incomplete.status, 503);
      const problem: unknown = await incomplete.json();
      assert.deepEqual(problem, {
        code: "SCHEMA_NOT_READY",
        message: "El esquema de Cocos no está listo.",
      });
      assertDocumentedResponse("get", "/health", {
        status: incomplete.status,
        body: problem,
      });
    });
  });
});

test("returns a correlated JSON error when PostgreSQL is unavailable", async (context) => {
  const pool = new Pool();
  const failure = new DatabaseError("private connection details", 0, "error");
  failure.code = "08006";
  context.mock.method(pool, "query", () => {
    throw failure;
  });
  const log = context.mock.method(console, "error", () => {});

  try {
    await withTestApi(pool, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body: unknown = await response.json();
      assert.deepEqual(body, {
        code: "DATABASE_UNAVAILABLE",
        message: "PostgreSQL no está disponible.",
      });
      assertDocumentedResponse("get", "/health", {
        status: response.status,
        body,
      });
      const requestId = response.headers.get("X-Request-Id");
      assert.ok(requestId);
      assert.equal(log.mock.callCount(), 1);
      const [entry] = log.mock.calls[0]?.arguments ?? [];
      assert.equal(typeof entry, "string");
      assert.deepEqual(JSON.parse(entry), {
        requestId,
        method: "GET",
        status: 503,
        code: "DATABASE_UNAVAILABLE",
        sqlstate: "08006",
      });
    });
  } finally {
    await pool.end();
  }
});
