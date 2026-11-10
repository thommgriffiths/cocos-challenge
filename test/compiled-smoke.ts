import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { promisify } from "node:util";
import { loadConfig } from "../src/config.ts";
import { requireLocalDatabaseUrl } from "../src/database.ts";
import { assertDocumentedResponse } from "./openapi.ts";

test(
  "compiled server reports correlated readiness errors and serves the initialized demo",
  { timeout: 30_000 },
  async () => {
    const demoUrl = requireLocalDatabaseUrl(
      process.env.DEMO_DATABASE_URL,
      "DEMO_DATABASE_URL",
      "cocos_demo",
    );
    const env = { ...process.env, DATABASE_URL: demoUrl.href };
    const { port } = loadConfig(env);
    const origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ["dist/server.js"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = createInterface({ input: server.stdout });
    const closed = once(server, "close");
    let diagnostics = "";
    server.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      diagnostics += chunk;
    });
    let requestId: string;

    async function getJson(path: string, status: number) {
      const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, status, path);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      return {
        status: response.status,
        body: (await response.json()) as unknown,
        headers: response.headers,
      };
    }

    try {
      const [startup] = await Promise.race([
        once(lines, "line", { signal: AbortSignal.timeout(8_000) }),
        closed.then(([code, signal]) => {
          throw new Error(
            `El servidor compilado terminó al arrancar (${code ?? signal}). ${diagnostics.trim()}`,
          );
        }),
      ]);
      assert.equal(startup, `API disponible en ${origin}`);

      const unready = await getJson("/health", 503);
      assert.equal(unready.headers.get("Cache-Control"), "no-store");
      const id = unready.headers.get("X-Request-Id");
      assert.ok(id);
      assert.match(id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
      requestId = id;
      assert.deepEqual(unready.body, {
        code: "SCHEMA_NOT_READY",
        message: "El esquema de Cocos no está listo.",
      });
      assertDocumentedResponse("get", "/health", unready);

      const missing = await getJson("/ruta-inexistente", 404);
      assert.deepEqual(missing.body, {
        code: "ROUTE_NOT_FOUND",
        message: "La ruta no existe.",
      });

      await promisify(execFile)(process.execPath, ["scripts/init-demo.ts"], {
        env,
        timeout: 10_000,
      });

      const ready = await getJson("/health", 200);
      assert.equal(ready.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(ready.body, { status: "ok" });
      assertDocumentedResponse("get", "/health", ready);

      const portfolio = await getJson("/users/1/portfolio", 200);
      assert.partialDeepStrictEqual(portfolio.body, {
        userId: 1,
        totalValue: "889756.00",
      });
      assertDocumentedResponse("get", "/users/{userId}/portfolio", portfolio);
    } finally {
      lines.close();
      const kill = setTimeout(() => server.kill("SIGKILL"), 6_000).unref();
      try {
        server.kill("SIGTERM");
        await closed;
      } finally {
        clearTimeout(kill);
      }
    }
    assert.deepEqual(await closed, [0, null]);
    const entry = diagnostics
      .split("\n")
      .find((line) => line.includes(requestId));
    assert.ok(entry, "El registro del servidor debe incluir el ID del 503.");
    assert.deepEqual(JSON.parse(entry), {
      requestId,
      method: "GET",
      status: 503,
      code: "SCHEMA_NOT_READY",
      sqlstate: "42P01",
    });
  },
);
