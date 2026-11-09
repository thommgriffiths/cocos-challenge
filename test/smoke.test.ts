import assert from "node:assert/strict";
import { test } from "node:test";
import { withTestDatabase } from "./database.ts";
import { withTestApi } from "./http.ts";

test("serves readiness over HTTP with PostgreSQL and independent fixtures", async () => {
  await withTestDatabase(async (pool) => {
    const fixture = await pool.query("SELECT accountnumber FROM users");
    assert.deepEqual(fixture.rows, [{ accountnumber: "SMOKE" }]);

    await withTestApi(pool, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    });
  });
});
