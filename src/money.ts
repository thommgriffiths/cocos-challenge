export function toCents(decimal: string) {
  const [whole, fraction = ""] = decimal.split(".");
  return BigInt(`${whole}${fraction.padEnd(2, "0")}`);
}

export function formatCents(cents: bigint) {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
