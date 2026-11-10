import type { Pool } from "pg";
import { readAccountResources } from "../account-resources.ts";
import { AppError } from "../errors.ts";
import { readLatestQuotes } from "../quotes.ts";
import { withTransaction } from "../transaction.ts";
import { readAverageCosts } from "./cost.ts";
import { valuePortfolio } from "./value.ts";

export function readPortfolio(pool: Pool, userId: number) {
  return withTransaction(pool, "REPEATABLE READ READ ONLY", async (client) => {
    const user = await client.query("SELECT 1 FROM users WHERE id = $1", [
      userId,
    ]);
    if (user.rowCount === 0) {
      throw new AppError("USER_NOT_FOUND", "La cuenta no existe.");
    }

    const resources = await readAccountResources(client, userId, {
      requireTradeDates: true,
    });
    const { positions } = resources;
    const openIds = [...positions]
      .filter(([, position]) => position.shares !== 0n)
      .map(([id]) => id);
    const quotes = await readLatestQuotes(client, openIds);
    const costIds = quotes
      .filter(
        ({ instrumentId, closeCents }) =>
          closeCents !== null &&
          (positions.get(instrumentId)?.shares ?? 0n) > 0n,
      )
      .map(({ instrumentId }) => instrumentId);
    const costs = await readAverageCosts(client, userId, costIds);

    return valuePortfolio(userId, resources, quotes, costs);
  });
}
