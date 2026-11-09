import { once } from "node:events";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { databaseConfig } from "./database.ts";

async function main() {
  const { databaseUrl, port } = loadConfig(process.env);
  const pool = new Pool(databaseConfig(databaseUrl));
  pool.on("error", () => {
    console.error("Se perdió una conexión inactiva con PostgreSQL.");
  });

  const server = createServer(createApp(pool));
  try {
    await pool.query("SELECT 1");
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  } catch {
    await pool.end();
    throw new Error("No se pudo conectar a PostgreSQL o abrir el puerto HTTP.");
  }

  function shutdown() {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    const deadline = setTimeout(() => server.closeAllConnections(), 5_000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      void pool.end().catch(() => {
        console.error("No se pudo cerrar el pool de PostgreSQL.");
        process.exitCode = 1;
      });
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(`API disponible en http://127.0.0.1:${port}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
