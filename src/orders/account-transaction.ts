import type { Pool, PoolClient } from "pg";
import { AppError } from "../errors.ts";

async function lockAccount(client: PoolClient, userId: number) {
  await client.query("SET LOCAL lock_timeout = '5s'");
  try {
    const result = await client.query(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (result.rowCount === 0) {
      throw new AppError("USER_NOT_FOUND", "La cuenta no existe.");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "55P03") {
      throw new AppError(
        "ACCOUNT_BUSY",
        "La cuenta está ocupada. Reintentá la solicitud.",
      );
    }
    throw error;
  }
  await client.query("SET LOCAL lock_timeout = 0");
}

export async function withLockedAccount<T>(
  pool: Pool,
  userId: number,
  run: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    // Availability is read in a later statement with a fresh snapshot after waiting.
    await lockAccount(client, userId);
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
