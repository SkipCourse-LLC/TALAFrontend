import assert from "node:assert/strict";
import { test } from "node:test";
import { constantEqual, password } from "../security.cjs";

test("new passwords accept 8 through 128 characters without composition requirements", () => {
  const invalidInput = (error) => error.status === 400 && error.code === "INVALID_INPUT";
  assert.throws(() => password("a".repeat(7)), invalidInput);
  assert.equal(password("a".repeat(8)), "a".repeat(8));
  assert.equal(password("a".repeat(128)), "a".repeat(128));
  assert.throws(() => password("a".repeat(129)), invalidInput);
});

test("login validation still accepts shorter existing credentials without changing them", () => {
  const invalidInput = (error) => error.status === 400 && error.code === "INVALID_INPUT";
  for (const supplied of ["a", "a".repeat(7), "a".repeat(128)]) {
    assert.equal(password(supplied, false), supplied);
  }
  assert.throws(() => password("", false), invalidInput);
  assert.throws(() => password("a".repeat(129), false), invalidInput);
});

test("constant-time nonce comparisons reject malformed Unicode without throwing", () => {
  const expected = "synthetic-nonce";
  assert.equal(constantEqual(expected, expected), true);
  assert.equal(constantEqual(expected, "different-nonce"), false);
  assert.equal(constantEqual(expected, "é".repeat(expected.length)), false);
  assert.equal(constantEqual(expected, undefined), false);
});

test("new passwords reject malformed Unicode without changing valid or legacy credentials", () => {
  for (const suffix of ["\ud800", "\udfff"]) {
    const synthetic = `synthetic-only-${suffix}`;
    assert.throws(() => password(synthetic), (error) => error.status === 400 && error.code === "INVALID_INPUT");
    assert.equal(password(synthetic, false) === synthetic, true, "Legacy credential validation must preserve the supplied value.");
  }
  const synthetic = "  synthetic-only-\u{1f331}-e\u0301  ";
  assert.equal(password(synthetic) === synthetic, true, "New credential validation must preserve valid Unicode and whitespace.");
  assert.equal(password(synthetic, false) === synthetic, true, "Legacy credential validation must preserve valid Unicode and whitespace.");
});
