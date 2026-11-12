import {
  normalizeReconciliationLimit,
  parseJsonObject,
} from "../_shared/yoco-http-validation.ts";

Deno.test("reconciliation input parser accepts only JSON objects", () => {
  const valid = parseJsonObject('{"limit":25}');
  if (!valid || valid.limit !== 25) {
    throw new Error("Valid JSON object was rejected.");
  }

  for (const value of ["", "{", "null", "[]", '"text"', "42", "true"]) {
    if (parseJsonObject(value) !== null) {
      throw new Error("Non-object or malformed JSON was accepted: " + value);
    }
  }
});

Deno.test("reconciliation limit defaults safely and is clamped to 1..100", () => {
  const cases: Array<[unknown, number]> = [
    [undefined, 30],
    [null, 30],
    ["not-a-number", 30],
    [0, 30],
    [-5, 30],
    [1, 1],
    ["12", 12],
    [12.9, 12],
    [100, 100],
    [101, 100],
    [1000, 100],
  ];

  for (const [input, expected] of cases) {
    const actual = normalizeReconciliationLimit(input);
    if (actual !== expected) {
      throw new Error(
        "Unexpected reconciliation limit for " + String(input) +
          ": expected " + expected + ", received " + actual,
      );
    }
  }
});
