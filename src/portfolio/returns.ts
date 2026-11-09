import { Decimal } from "decimal.js";

export const ReturnDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export function formatReturn(closeCents: bigint, basisCents: Decimal | bigint) {
  const percent = new ReturnDecimal(closeCents.toString())
    .minus(basisCents.toString())
    .times(100)
    .div(basisCents.toString())
    .toFixed(2);
  return percent === "-0.00" ? "0.00" : percent;
}
