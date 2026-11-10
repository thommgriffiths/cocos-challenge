import { invalidRequest } from "../errors.ts";
import { positiveInt } from "../http-input.ts";
import { toCents } from "../money.ts";

export type OrderInput = {
  instrumentId: number;
  side: "BUY" | "SELL";
  pricing: { type: "MARKET" } | { type: "LIMIT"; cents: bigint };
  quantity: { size: number } | { amountCents: bigint };
};

export function parseIdempotencyKey(values: string[] | undefined) {
  if (values === undefined) return undefined;
  const [key] = values;
  if (values.length !== 1 || !key || !/^[A-Za-z0-9._~-]{1,128}$/.test(key)) {
    throw invalidRequest(
      "Idempotency-Key debe enviarse una sola vez con entre 1 y 128 caracteres válidos.",
    );
  }
  return key;
}

function positiveMoney(value: unknown, field: string, maxDigits: number) {
  const decimal = new RegExp(`^\\d{1,${maxDigits}}(?:\\.\\d{1,2})?$`);
  if (typeof value !== "string" || !decimal.test(value)) {
    throw invalidRequest(`${field} debe ser un importe decimal válido en ARS.`);
  }
  const cents = toCents(value);
  if (cents <= 0n) {
    throw invalidRequest(`${field} debe ser mayor que cero.`);
  }
  return cents;
}

export function parseOrderInput(body: unknown): OrderInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest("Enviá un objeto JSON para la orden.");
  }
  const { instrumentId, side, type, price, size, amount } = body as Record<
    string,
    unknown
  >;
  if (side !== "BUY" && side !== "SELL") {
    throw invalidRequest("side debe ser BUY o SELL.");
  }
  if (type !== "MARKET" && type !== "LIMIT") {
    throw invalidRequest("type debe ser MARKET o LIMIT.");
  }
  const hasSize = Object.hasOwn(body, "size");
  if (hasSize === Object.hasOwn(body, "amount")) {
    throw invalidRequest("Enviá exactamente uno entre size y amount.");
  }

  return {
    instrumentId: positiveInt(instrumentId, "instrumentId"),
    side,
    pricing:
      type === "LIMIT"
        ? { type, cents: positiveMoney(price, "price", 8) }
        : { type },
    quantity: hasSize
      ? { size: positiveInt(size, "size") }
      : { amountCents: positiveMoney(amount, "amount", 18) },
  };
}
