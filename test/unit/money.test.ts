import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCents, toCents } from "../../src/money.ts";

test("converts and formats exact cents without passing through a floating-point number", () => {
  const inputCases = [
    ["1", 100n],
    ["1.2", 120n],
    ["0.01", 1n],
    ["999999999999999999.99", 99_999_999_999_999_999_999n],
  ] as const;
  for (const [input, cents] of inputCases) {
    assert.equal(toCents(input), cents, input);
  }

  const outputCases = [
    [0n, "0.00"],
    [1n, "0.01"],
    [120n, "1.20"],
    [-1n, "-0.01"],
    [-120n, "-1.20"],
    [9_007_199_254_740_993n, "90071992547409.93"],
  ] as const;
  for (const [cents, output] of outputCases) {
    assert.equal(formatCents(cents), output, cents.toString());
  }
});
