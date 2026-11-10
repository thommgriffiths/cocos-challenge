import { invalidRequest } from "../errors.ts";
import { maxInt32 } from "../http-input.ts";
import type { OrderInput } from "./input.ts";

export function orderSize(
  quantity: OrderInput["quantity"],
  priceCents: bigint,
) {
  if ("size" in quantity) {
    return quantity.size;
  }
  const size = quantity.amountCents / priceCents;
  if (size < 1n || size > BigInt(maxInt32)) {
    throw invalidRequest(
      "El monto produce una cantidad de acciones fuera del rango permitido.",
    );
  }
  return Number(size);
}

type PricedOrder = {
  side: OrderInput["side"];
  type: OrderInput["pricing"]["type"];
  size: number;
  priceCents: bigint;
};

type OrderResources = {
  cashCents: bigint;
  reservedCashCents: bigint;
  position?: { shares: bigint; reservedShares: bigint };
};

export function decideOrder(
  { side, type, size, priceCents }: PricedOrder,
  { cashCents, reservedCashCents, position }: OrderResources,
) {
  const units = BigInt(size);
  if (side === "BUY" && units * priceCents > cashCents - reservedCashCents) {
    return {
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_CASH",
    } as const;
  }

  const availableShares =
    (position?.shares ?? 0n) - (position?.reservedShares ?? 0n);
  if (side === "SELL" && units > availableShares) {
    return {
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_SHARES",
    } as const;
  }

  return { status: type === "MARKET" ? "FILLED" : "NEW" } as const;
}
