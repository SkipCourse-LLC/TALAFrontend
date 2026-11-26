/** The limit counts UTF-16 code units; astral characters remain intact. */
export const MAX_EVIDENCE_PREVIEW_CHARACTERS = 20_000;
export class EvidenceTextEncodingError extends Error {
  constructor() {
    super("This file is not valid UTF-8 text.");
    this.name = "EvidenceTextEncodingError";
  }
}

export function decodeEvidenceTextPreview(bytes: Uint8Array): {
  text: string;
  truncated: boolean;
} {
  let text: string;
  try {
    // Decode the complete bounded download. Invalid bytes after the preview
    // boundary must not make a malformed file appear to be valid text.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EvidenceTextEncodingError();
  }
  if (text.length <= MAX_EVIDENCE_PREVIEW_CHARACTERS)
    return { text, truncated: false };
  let end = MAX_EVIDENCE_PREVIEW_CHARACTERS;
  const last = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
    end--;
  return { text: text.slice(0, end), truncated: true };
}
