import { count, id, instant, object, text } from "./decoders";
import { TalaApiError } from "./errors";
import type { ReflectionDraft } from "./types";

function wellFormed(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function unsafeControls(value: string, paragraphs = false) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      (code < 32 && !(paragraphs && (code === 9 || code === 10))) ||
      code === 127
    )
      return true;
  }
  return false;
}

export function reflectionDraftProblem(title: string, value: string): string {
  if (title.length > 120) return "Use a title of 120 characters or fewer.";
  if (value.length > 5000)
    return "Use a reflection of 5,000 characters or fewer.";
  if (!wellFormed(title) || !wellFormed(value))
    return "Remove the incomplete character and type it again before saving.";
  if (
    unsafeControls(title) ||
    unsafeControls(value.replace(/\r\n/g, "\n"), true)
  )
    return "Remove unsupported characters before saving.";
  if (!title.trim() && !value.trim())
    return "Add a title or a reflection before saving.";
  return "";
}

export function decodeReflectionDraft(raw: unknown): ReflectionDraft {
  const value = object(raw);
  const title = text(value.title, 120, true);
  const content = text(value.text, 5000, true);
  const version = count(value.version);
  const updatedAt = value.updatedAt === null ? null : instant(value.updatedAt);
  if (
    !["empty", "saved"].includes(String(value.status)) ||
    (value.status === "empty" && (title !== "" || content !== "")) ||
    (value.status === "saved" &&
      (version === 0 || Boolean(reflectionDraftProblem(title, content)))) ||
    (version === 0 && (updatedAt !== null || value.status !== "empty")) ||
    (version > 0 && updatedAt === null)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    ownerUid: id(value.ownerUid),
    title,
    text: content,
    status: value.status as ReflectionDraft["status"],
    version,
    updatedAt,
  };
}
