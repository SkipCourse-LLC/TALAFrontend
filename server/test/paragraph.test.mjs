import assert from "node:assert/strict";
import { test } from "node:test";
import { paragraph, text } from "../security.cjs";

test("review paragraphs normalize CRLF and allow bounded line breaks without relaxing single-line fields", () => {
  assert.equal(paragraph("  First explanation.\r\n\tSecond step.  ", "review note"), "First explanation.\n\tSecond step.");
  assert.equal(paragraph("x".repeat(1000), "learning summary").length, 1000);
  for (const value of ["x".repeat(1001), " \n\t ", null, "line\x00break", "line\x01break", "line\vbreak", "line\fbreak", "line\rbreak", "line\x1fbreak", "line\x7fbreak"]) {
    assert.throws(() => paragraph(value, "review note"), (error) => error.status === 400 && error.code === "INVALID_INPUT");
  }
  assert.throws(() => text("Name\nInjected line", "display name"), (error) => error.code === "INVALID_INPUT");
  assert.throws(() => text("Title\tInjected field", "evidence title"), (error) => error.code === "INVALID_INPUT");
});
