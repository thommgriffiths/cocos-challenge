import { AppError } from "../errors.ts";
import { formatCents } from "../money.ts";
import type { LatestQuote } from "../quotes.ts";
import type { CostState } from "./cost.ts";
import { formatReturn } from "./returns.ts";

type PortfolioResources = {
  cashCents: bigint;
  reservedCashCents: bigint;
  positions: ReadonlyMap<number, { shares: bigint }>;
};

type PortfolioPosition = {
  instrumentId: number;
  ticker: string | null;
  quantity: number;
  marketValue: string | null;
  positionReturnPct: string | null;
  dailyReturnPct: string | null;
  historicalNegative: boolean;
};

export function valuePortfolio(
  userId: number,
  { cashCents, reservedCashCents, positions }: PortfolioResources,
  openQuotes: readonly LatestQuote[],
  costs: ReadonlyMap<number, CostState>,
) {
  let totalCents: bigint | null = cashCents;
  const openPositions: PortfolioPosition[] = [];
  for (const {
    instrumentId,
    ticker,
    closeCents,
    previousCloseCents,
  } of openQuotes) {
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
}
