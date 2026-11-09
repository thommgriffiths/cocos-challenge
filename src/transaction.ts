import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
  pool: Pool,
  mode: "READ COMMITTED" | "REPEATABLE READ READ ONLY",
  run: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${mode}`);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
