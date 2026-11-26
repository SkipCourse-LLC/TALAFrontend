/** Keep text lossless when JSON strings become UTF-8 database/file bytes. */
export function isWellFormedText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** ASCII controls are rejected; paragraph notes may contain tabs and LF. */
export function hasTextControls(value: string, paragraph = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      (code < 32 && !(paragraph && (code === 9 || code === 10))) ||
      code === 127
    )
      return true;
  }
  return false;
}
