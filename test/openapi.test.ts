import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import openapi from "../docs/openapi.json" with { type: "json" };
import { withTestApi } from "./http.ts";

test("serves Swagger UI and the five-operation OpenAPI contract without querying PostgreSQL", async (context) => {
  const pool = new Pool();
  const query = context.mock.method(pool, "query", () => {
    throw new Error("Documentation must not query PostgreSQL");
  });

  try {
    await withTestApi(pool, async (baseUrl) => {
      async function get(path: string, contentType: RegExp) {
        const response = await fetch(`${baseUrl}${path}`, {
          signal: AbortSignal.timeout(4_000),
        });
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("content-type") ?? "", contentType);
        return response;
      }

      const html = await (await get("/docs", /text\/html/)).text();
      assert.equal(await (await get("/docs/", /text\/html/)).text(), html);
      assert.match(html, /url: "\/openapi\.json"/);
      assert.match(html, /validatorUrl: null/);
      for (const [path, contentType] of [
        ["/docs/assets/swagger-ui-bundle.js", /javascript/],
        ["/docs/assets/swagger-ui.css", /text\/css/],
      ] as const) {
        assert.ok(html.includes(`"${path}"`));
        assert.ok(
          (await (await get(path, contentType)).arrayBuffer()).byteLength,
        );
      }

      const response = await get("/openapi.json", /application\/json/);
      assert.deepEqual(await response.json(), openapi);
      assert.deepEqual(openapi.servers, [{ url: "/" }]);
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(openapi.paths).map(([path, methods]) => [
            path,
            Object.keys(methods),
          ]),
        ),
        {
          "/health": ["get"],
          "/instruments": ["get"],
          "/users/{userId}/portfolio": ["get"],
          "/users/{userId}/orders": ["post"],
          "/users/{userId}/orders/{orderId}/cancel": ["post"],
        },
      );
    });
    assert.equal(query.mock.callCount(), 0);
  } finally {
    await pool.end();
  }
});
