import assert from "node:assert/strict";
import { test } from "node:test";
import { constantEqual } from "../security.cjs";

test("constant-time nonce comparisons reject malformed Unicode without throwing", () => {
  const expected = "synthetic-nonce";
  assert.equal(constantEqual(expected, expected), true);
  assert.equal(constantEqual(expected, "different-nonce"), false);
  assert.equal(constantEqual(expected, "é".repeat(expected.length)), false);
  assert.equal(constantEqual(expected, undefined), false);
});
