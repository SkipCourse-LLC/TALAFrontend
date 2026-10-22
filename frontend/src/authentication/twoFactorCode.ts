export function normalizeVerificationCode(value: string): string {
  return value
    .replace(/[０-９]/g, (digit) =>
      String(digit.charCodeAt(0) - "０".charCodeAt(0)),
    )
    .replace(/[\s-]/g, "");
}
