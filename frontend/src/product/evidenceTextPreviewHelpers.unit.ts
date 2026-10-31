import { expect, test } from "@playwright/test";
import {
  decodeEvidenceTextPreview,
  EvidenceTextEncodingError,
  MAX_EVIDENCE_PREVIEW_CHARACTERS,
} from "./evidenceTextPreviewHelpers";
const encode = (text: string) => new TextEncoder().encode(text);

test("plain submitted text remains literal, including HTML-shaped content and whitespace", () => {
  const text =
    '<script>example()</script> & <img src="example" onerror="example()">\n\tLearning notes';
  expect(decodeEvidenceTextPreview(encode(text))).toEqual({
    text,
    truncated: false,
  });
  expect(decodeEvidenceTextPreview(encode(""))).toEqual({
    text: "",
    truncated: false,
  });
});
test("the exact UTF-16 limit is complete while one extra code unit is explicitly shortened", () => {
  const text = "a".repeat(MAX_EVIDENCE_PREVIEW_CHARACTERS);
  expect(decodeEvidenceTextPreview(encode(text))).toEqual({
    text,
    truncated: false,
  });
  expect(decodeEvidenceTextPreview(encode(`${text}b`))).toEqual({
    text,
    truncated: true,
  });
});
test("shortening never splits an astral surrogate pair at either side of the boundary", () => {
  const before = "a".repeat(MAX_EVIDENCE_PREVIEW_CHARACTERS - 1);
  const at = "a".repeat(MAX_EVIDENCE_PREVIEW_CHARACTERS - 2);
  expect(decodeEvidenceTextPreview(encode(`${before}🚀tail`))).toEqual({
    text: before,
    truncated: true,
  });
  expect(decodeEvidenceTextPreview(encode(`${at}🚀tail`))).toEqual({
    text: `${at}🚀`,
    truncated: true,
  });
});
test("fatal UTF-8 decoding rejects malformed, overlong and surrogate byte sequences even after the preview limit", () => {
  for (const bytes of [[0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff]])
    expect(() => decodeEvidenceTextPreview(new Uint8Array(bytes))).toThrow(
      EvidenceTextEncodingError,
    );
  const bytes = new Uint8Array(MAX_EVIDENCE_PREVIEW_CHARACTERS + 1);
  bytes.fill(0x61);
  bytes[MAX_EVIDENCE_PREVIEW_CHARACTERS] = 0xff;
  expect(() => decodeEvidenceTextPreview(bytes)).toThrow(
    EvidenceTextEncodingError,
  );
});
