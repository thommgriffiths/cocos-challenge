import type { Pool, PoolClient } from "pg";
import { AppError } from "../errors.ts";
import { withTransaction } from "../transaction.ts";

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
        { cause: error },
      );
    }
    throw error;
  }
  await client.query("SET LOCAL lock_timeout = 0");
}

export function withLockedAccount<T>(
  pool: Pool,
  userId: number,
  run: (client: PoolClient) => Promise<T>,
) {
  return withTransaction(pool, "READ COMMITTED", async (client) => {
    // Availability is read in a later statement with a fresh snapshot after waiting.
    await lockAccount(client, userId);
    return run(client);
  });
}
