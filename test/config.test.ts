import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { requireLocalDatabaseUrl } from "../src/database.ts";

const demoUrl = "postgresql://cocos:local@127.0.0.1:55432/cocos_demo";

test("validates the port and explicit application database at startup", () => {
  assert.equal(loadConfig({ DATABASE_URL: demoUrl }).port, 3000);
  assert.throws(
    () => loadConfig({ DATABASE_URL: demoUrl, PORT: "3000x" }),
    /PORT/,
  );
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
});

test("rejects database write targets outside the dedicated local instance", () => {
  for (const url of [
    undefined,
    demoUrl.replace("127.0.0.1", "example.test"),
    demoUrl.replace("/cocos_demo", "/postgres"),
    demoUrl.replace("cocos:local", "postgres:local"),
    `${demoUrl}?host=example.test`,
  ]) {
    assert.throws(
      () => requireLocalDatabaseUrl(url, "DEMO_DATABASE_URL", "cocos_demo"),
      /DEMO_DATABASE_URL/,
    );
  }
});
