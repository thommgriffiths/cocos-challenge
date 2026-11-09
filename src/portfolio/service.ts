import type { Pool } from "pg";
import { readAccountResources } from "../account-resources.ts";
import { AppError } from "../errors.ts";
import { formatCents } from "../money.ts";
import { readLatestQuotes } from "../quotes.ts";
import { withTransaction } from "../transaction.ts";
import { readAverageCosts } from "./cost.ts";
import { formatReturn } from "./returns.ts";

type PortfolioPosition = {
  instrumentId: number;
  ticker: string | null;
  quantity: number;
  marketValue: string | null;
  positionReturnPct: string | null;
  dailyReturnPct: string | null;
  historicalNegative: boolean;
};

export function readPortfolio(pool: Pool, userId: number) {
  return withTransaction(pool, "REPEATABLE READ READ ONLY", async (client) => {
    const user = await client.query("SELECT 1 FROM users WHERE id = $1", [
      userId,
    ]);
    if (user.rowCount === 0) {
      throw new AppError("USER_NOT_FOUND", "La cuenta no existe.");
    }

    const { cashCents, reservedCashCents, positions } =
      await readAccountResources(client, userId, {
        requireTradeDates: true,
      });
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

    let totalCents: bigint | null = cashCents;
    const openPositions: PortfolioPosition[] = [];
    for (const {
      instrumentId,
      ticker,
      closeCents,
      previousCloseCents,
    } of quotes) {
      const shares = positions.get(instrumentId)?.shares ?? 0n;
      const quantity = Number(shares);
      if (!Number.isSafeInteger(quantity)) {
        throw new AppError(
          "DATA_INTEGRITY",
          "La cantidad de la posición excede el rango seguro.",
        );
      }

      let marketValue: string | null = null;
      let positionReturnPct: string | null = null;
      let dailyReturnPct: string | null = null;
      if (closeCents === null) {
        totalCents = null;
      } else {
        const valueCents = shares * closeCents;
        marketValue = formatCents(valueCents);
        if (totalCents !== null) totalCents += valueCents;
        if (previousCloseCents !== null)
          dailyReturnPct = formatReturn(closeCents, previousCloseCents);
        if (shares > 0n) {
          const cost = costs.get(instrumentId);
          if (!cost?.averageCents || cost.shares !== shares) {
            throw new AppError(
              "DATA_INTEGRITY",
              "No se pudo determinar el costo de la posición.",
            );
          }
          positionReturnPct = formatReturn(closeCents, cost.averageCents);
        }
      }

      openPositions.push({
        instrumentId,
        ticker,
        quantity,
        marketValue,
        positionReturnPct,
        dailyReturnPct,
        historicalNegative: shares < 0n,
      });
    }

    return {
      userId,
      cash: formatCents(cashCents),
      availableCash: formatCents(cashCents - reservedCashCents),
      totalValue: totalCents === null ? null : formatCents(totalCents),
      positions: openPositions,
    };
  });
}
