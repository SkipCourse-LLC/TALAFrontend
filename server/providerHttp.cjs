"use strict";
// Shared HTTP plumbing for outside providers (Google, HubSpot, EZAMU).
// Provider failures never leak secrets, raw bodies or tokens into errors.
const { ApiError } = require("./security.cjs");

const DEFAULT_TIMEOUT_MS = 10_000;

/** Provider endpoints must be HTTPS. Plain HTTP is allowed only for a local fake in tests. */
function providerBase(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a full URL.`); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error(`${name} must use HTTPS.`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} must not contain credentials, a query or a fragment.`);
  return url.href.replace(/\/$/, "");
}

/** Raised for any provider failure. `status` is the provider's HTTP status (0 when unreachable). */
class ProviderError extends Error {
  constructor(provider, status, reason, retryAfterSeconds) {
    super(`${provider} request failed (${status || "unreachable"}${reason ? `: ${reason}` : ""}).`);
    this.provider = provider;
    this.status = status;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Calls a provider and returns parsed JSON. Throws ProviderError on timeout,
 * network failure, non-2xx status or a non-JSON body. `reason` is a short
 * machine-readable code from the provider (for example "invalid_grant"), never a body dump.
 */
async function providerJson(provider, url, { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch (error) {
    throw new ProviderError(provider, 0, error?.name === "TimeoutError" ? "timeout" : "network");
  }
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const reason = typeof parsed?.error === "string" ? parsed.error
      : typeof parsed?.error?.status === "string" ? parsed.error.status
      : typeof parsed?.category === "string" ? parsed.category : "";
    throw new ProviderError(provider, response.status, reason.slice(0, 60), Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  if (parsed === null && raw) throw new ProviderError(provider, response.status, "not_json");
  return parsed ?? {};
}

/** Turns any provider failure into the API's 503 so routes never show a false success. */
function integrationUnavailable(service, error) {
  const message = error instanceof ProviderError && (error.status === 401 || error.reason === "invalid_grant")
    ? `The ${service} service rejected TALA's sign-in. Staff need to reconnect it.`
    : `The ${service} service is unavailable right now. Try again later.`;
  return new ApiError(503, "INTEGRATION_UNAVAILABLE", message);
}

module.exports = { providerBase, providerJson, ProviderError, integrationUnavailable, DEFAULT_TIMEOUT_MS };
