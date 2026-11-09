import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import {
  assertDatabase,
  databaseConfig,
  requireLocalDatabaseUrl,
} from "../src/database.ts";

export async function withTestDatabase(run: (pool: Pool) => Promise<void>) {
  const url = requireLocalDatabaseUrl(
    process.env.TEST_DATABASE_URL,
    "TEST_DATABASE_URL",
    "postgres",
  );
  const admin = new Client(databaseConfig(url));
  const database = `cocos_test_${randomUUID().replaceAll("-", "")}`;

  try {
    await admin.connect();
    await assertDatabase(admin, "postgres");
    // The identifier consists of a fixed prefix and a locally generated UUID.
    await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`);
    try {
      url.pathname = `/${database}`;
      const pool = new Pool(databaseConfig(url));
      try {
        await pool.query(
          await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
        );
        await pool.query(
          await readFile(new URL("./fixtures.sql", import.meta.url), "utf8"),
        );
        await run(pool);
      } finally {
        await pool.end();
      }
    } finally {
      await admin.query(`DROP DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }
}
