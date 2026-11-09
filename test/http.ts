import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Pool } from "pg";
import { createApp } from "../src/app.ts";

export async function withTestApi(
  pool: Pool,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp(pool));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
