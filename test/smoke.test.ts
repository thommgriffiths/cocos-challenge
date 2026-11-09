import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { withTestDatabase } from "./database.ts";

test("serves readiness over HTTP with PostgreSQL and independent fixtures", async () => {
  await withTestDatabase(async (pool) => {
    const fixture = await pool.query("SELECT accountnumber FROM users");
    assert.deepEqual(fixture.rows, [{ accountnumber: "SMOKE" }]);

    const server = createServer(createApp(pool));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
