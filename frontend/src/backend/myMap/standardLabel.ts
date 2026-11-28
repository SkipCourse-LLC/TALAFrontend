/**
 * Some stored standards carry an internal ID (e.g. "7gk07ixenb556joz7e5z") where a
 * human-readable code like "HS.ESS1.1" belongs. These helpers keep those IDs out of the UI.
 */

/** Internal IDs have no separators and mix letters and digits. */
export function isOpaqueStandardId(value: string): boolean {
  return /^[a-z0-9]{16,}$/i.test(value) && /\d/.test(value) && /[a-z]/i.test(value);
}

/**
 * First candidate that isn't an internal ID, or "" if none qualify. Anything else is shown
 * exactly as stored, since real codes vary in format and length (e.g. "HS.12", "ENG2.a10").
 */
export function readableStandardCode(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && !isOpaqueStandardId(value)) return value;
  }
  return '';
}

/** A short name for a standard: its readable code, else the start of its description. */
export function standardDisplayLabel(
  codes: Array<string | null | undefined>,
  description?: string | null,
  maxLength = 48,
): string {
  const code = readableStandardCode(...codes);
  if (code) return code;
  const text = description?.trim().replace(/\s+/g, ' ');
  if (!text) return 'Standard';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/**
 * A readable name for a standard: its first sentence, cut at a word boundary. Codes such as
 * "VA:HSAdv.Cr2.c" or "6.1" say nothing on their own, so the map names a node by what it says.
 */
export function standardShortName(description: string | null | undefined, fallback: string, maxLength = 48): string {
  const text = description?.trim().replace(/\s+/g, ' ');
  if (!text) return fallback;
  const sentence = text.split(/(?<=[.;:])\s/)[0]!.replace(/[.;:]+$/, '');
  if (sentence.length <= maxLength) return sentence;
  const cut = sentence.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxLength * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '')}…`;
}

/** A standard a piece of text may cite: every code/ID it is known by, plus its description. */
export interface StandardRef {
  codes: Array<string | null | undefined>;
  description?: string | null;
}

// Mixed letters/digits, 16+ chars, standing alone (not part of a URL, path or longer word)
const OPAQUE_ID_IN_TEXT = /(?<![\w/=?&#.-])(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{16,}(?![\w/-])/gi;

/**
 * Swap internal standard IDs inside free text (AI feedback, chat replies) for a readable name.
 * IDs of a known standard become its code, or its quoted description; any other ID becomes
 * "this standard".
 */
export function replaceStandardIdsInText(text: string, standards: StandardRef[] = []): string {
  if (!text) return text;
  const names = new Map<string, string>();
  for (const standard of standards) {
    const code = readableStandardCode(...standard.codes);
    const description = standard.description?.trim();
    const name = code || (description ? `“${standardDisplayLabel([], description, 60)}”` : 'this standard');
    for (const id of standard.codes) {
      if (id && isOpaqueStandardId(id)) names.set(id.toLowerCase(), name);
    }
  }
  return text.replace(OPAQUE_ID_IN_TEXT, (id) => names.get(id.toLowerCase()) ?? 'this standard');
}
