export function classLocationProblem(value: string) {
  const location = value.trim();
  if (
    !/^(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|vbscript:|\/\/)/i.test(
      location,
    )
  )
    return "";
  try {
    const url = new URL(location);
    if (
      url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password &&
      !/\s/u.test(location) &&
      url.href.length <= 1000
    )
      return "";
  } catch {
    /* The field below explains how to correct a malformed URL. */
  }
  return "Use an HTTPS joining URL without embedded credentials, or enter a plain-text venue.";
}
