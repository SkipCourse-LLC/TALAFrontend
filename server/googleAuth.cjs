"use strict";
// Server-to-Google OAuth: trades a stored refresh token for short-lived access
// tokens. Values come from environment variables only and never reach logs,
// errors or API responses.
const { providerJson, providerBase, ProviderError } = require("./providerHttp.cjs");

const REFRESH_EARLY_MS = 60_000;

function createGoogleTokenSource({ clientId, clientSecret, refreshToken, tokenUrl, timeoutMs, now = Date.now }) {
  for (const [name, value] of Object.entries({ clientId, clientSecret, refreshToken })) {
    if (typeof value !== "string" || value.length < 8) throw new Error(`Google ${name} is missing. Set it in the server environment.`);
  }
  let cached = null;
  let inFlight = null;

  async function refresh() {
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
    const result = await providerJson("Google sign-in", tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs,
    });
    if (typeof result.access_token !== "string" || !Number.isFinite(result.expires_in)) throw new ProviderError("Google sign-in", 200, "bad_token_response");
    cached = { token: result.access_token, expiresAt: now() + result.expires_in * 1000 };
    return cached.token;
  }

  /** Returns a valid access token, refreshing at most once even when many calls arrive together. */
  async function accessToken({ force = false } = {}) {
    if (!force && cached && cached.expiresAt - REFRESH_EARLY_MS > now()) return cached.token;
    if (force) cached = null;
    if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Calls a Google API with the token, refreshing once and retrying once on 401. */
  async function call(provider, url, options = {}) {
    const send = async (token) => providerJson(provider, url, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${token}` }, timeoutMs });
    try {
      return await send(await accessToken());
    } catch (error) {
      if (!(error instanceof ProviderError) || error.status !== 401) throw error;
      return send(await accessToken({ force: true }));
    }
  }

  return { accessToken, call };
}

/** Reads Google settings from the environment and checks their shape (never their secret values). */
function googleSettings(env) {
  const timeout = env.TALA_PROVIDER_TIMEOUT_MS;
  if (timeout !== undefined && !(Number.isInteger(Number(timeout)) && Number(timeout) >= 100 && Number(timeout) <= 60_000)) throw new Error("TALA_PROVIDER_TIMEOUT_MS must be 100 to 60000 milliseconds.");
  return {
    clientId: env.TALA_GOOGLE_CLIENT_ID,
    clientSecret: env.TALA_GOOGLE_CLIENT_SECRET,
    refreshToken: env.TALA_GOOGLE_REFRESH_TOKEN,
    tokenUrl: providerBase(env.TALA_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", "TALA_GOOGLE_TOKEN_URL"),
    apiBase: providerBase(env.TALA_GOOGLE_API_BASE || "https://www.googleapis.com", "TALA_GOOGLE_API_BASE"),
    calendarId: env.TALA_GOOGLE_CALENDAR_ID || "primary",
    gmailSender: env.TALA_GMAIL_SENDER,
    timeoutMs: timeout === undefined ? undefined : Number(timeout),
  };
}

module.exports = { createGoogleTokenSource, googleSettings };
