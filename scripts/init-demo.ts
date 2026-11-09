import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  assertDatabase,
  databaseConfig,
  requireLocalDatabaseUrl,
} from "../src/database.ts";

async function initializeDemo() {
  const database = "cocos_demo";
  const url = requireLocalDatabaseUrl(
    process.env.DEMO_DATABASE_URL,
    "DEMO_DATABASE_URL",
    database,
  );
  const [schema, seed] = await Promise.all([
    readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/demo.sql", import.meta.url), "utf8"),
  ]);

  const client = new Client(databaseConfig(url));
  try {
    await client.connect();
    await assertDatabase(client, database);
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(600217)");
      const result = await client.query<{ hasRelations: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname NOT IN ('information_schema', 'pg_catalog')
            AND left(namespace.nspname, 3) <> 'pg_'
        ) AS "hasRelations"
      `);
      if (result.rows[0]?.hasRelations !== false) {
        throw new Error(
          "La base de demo contiene relaciones. Usá una base vacía.",
        );
      }
      await client.query(schema);
      await client.query(seed);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log("Base de demo inicializada.");
  } finally {
    await client.end();
  }
}

initializeDemo().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
