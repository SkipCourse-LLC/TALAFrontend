// A local stand-in for Google's OAuth token endpoint, Calendar API and Gmail
// API, used only by tests. It answers with Google's documented response shapes
// and can be switched into each failure Google can produce. No real Google
// account, project or secret is involved.
import { createServer } from "node:http";

export const FAKE_GOOGLE_CREDENTIALS = Object.freeze({
  clientId: "fake-client-id-for-tests",
  clientSecret: "fake-client-secret-for-tests",
  refreshToken: "fake-refresh-token-for-tests",
});

export async function startFakeGoogle() {
  const state = {
    tokenMode: "ok", // ok | invalid_grant | error500 | bad_json
    eventMode: "ok", // ok | pending | failure | no_link | unauthorized_once | quota | error500 | slow
    gmailMode: "ok", // ok | unauthorized | rate_limited | error500
    expiresIn: 3600,
    delayMs: 0,
    issued: [],
    revoked: new Set(),
    tokenCalls: 0,
    events: [],
    messages: [],
    unauthorizedServed: false,
  };

  function json(res, status, body, headers = {}) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }
  async function read(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  function bearerOk(req) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
    return Boolean(token && state.issued.includes(token) && !state.revoked.has(token));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const body = await read(req);

    if (req.method === "POST" && url.pathname === "/token") {
      state.tokenCalls += 1;
      const form = new URLSearchParams(body);
      const valid = form.get("grant_type") === "refresh_token"
        && form.get("client_id") === FAKE_GOOGLE_CREDENTIALS.clientId
        && form.get("client_secret") === FAKE_GOOGLE_CREDENTIALS.clientSecret
        && form.get("refresh_token") === FAKE_GOOGLE_CREDENTIALS.refreshToken;
      if (state.tokenMode === "error500") return json(res, 500, { error: "internal_failure" });
      if (state.tokenMode === "bad_json") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>"); }
      if (!valid || state.tokenMode === "invalid_grant") return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      const token = `fake-access-token-${state.issued.length + 1}`;
      state.issued.push(token);
      return json(res, 200, { access_token: token, expires_in: state.expiresIn, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar.events" });
    }

    const calendar = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (req.method === "POST" && calendar) {
      if (state.delayMs || state.eventMode === "slow") await new Promise((resolve) => setTimeout(resolve, state.delayMs || 1500));
      if (state.eventMode === "unauthorized_once" && !state.unauthorizedServed) {
        state.unauthorizedServed = true;
        return json(res, 401, { error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } });
      }
      if (!bearerOk(req)) return json(res, 401, { error: { code: 401, status: "UNAUTHENTICATED", message: "Invalid Credentials" } });
      if (state.eventMode === "quota") return json(res, 403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Rate Limit Exceeded" } });
      if (state.eventMode === "error500") return json(res, 500, { error: { code: 500, status: "INTERNAL", message: "Backend Error" } });
      const requested = JSON.parse(body);
      const id = `fakeevent${state.events.length + 1}`;
      state.events.push({ calendarId: decodeURIComponent(calendar[1]), query: Object.fromEntries(url.searchParams), body: requested, authorization: req.headers.authorization });
      const event = { kind: "calendar#event", id, status: "confirmed", summary: requested.summary, start: requested.start, end: requested.end };
      const code = `abc-defg-${String(state.events.length).padStart(3, "0")}`;
      if (state.eventMode === "pending") event.conferenceData = { createRequest: { requestId: requested.conferenceData.createRequest.requestId, status: { statusCode: "pending" } } };
      else if (state.eventMode === "failure") event.conferenceData = { createRequest: { status: { statusCode: "failure" } } };
      else if (state.eventMode === "no_link") event.conferenceData = { createRequest: { status: { statusCode: "success" } }, entryPoints: [{ entryPointType: "video", uri: "https://evil.example/join" }] };
      else {
        event.hangoutLink = `https://meet.google.com/${code}`;
        event.conferenceData = {
          createRequest: { requestId: requested.conferenceData.createRequest.requestId, status: { statusCode: "success" } },
          entryPoints: [{ entryPointType: "video", uri: `https://meet.google.com/${code}`, label: `meet.google.com/${code}` }],
          conferenceSolution: { key: { type: "hangoutsMeet" }, name: "Google Meet" },
        };
      }
      return json(res, 200, event);
    }

    if (req.method === "POST" && url.pathname === "/gmail/v1/users/me/messages/send") {
      if (state.gmailMode === "unauthorized" || !bearerOk(req)) return json(res, 401, { error: { code: 401, status: "UNAUTHENTICATED" } });
      if (state.gmailMode === "rate_limited") return json(res, 429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "30" });
      if (state.gmailMode === "error500") return json(res, 500, { error: { code: 500, status: "INTERNAL" } });
      const { raw } = JSON.parse(body);
      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      const id = `fakemessage${state.messages.length + 1}`;
      state.messages.push({ id, decoded });
      return json(res, 200, { id, threadId: id, labelIds: ["SENT"] });
    }

    json(res, 404, { error: { code: 404, status: "NOT_FOUND" } });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    env(extra = {}) {
      return {
        TALA_GOOGLE_CLIENT_ID: FAKE_GOOGLE_CREDENTIALS.clientId,
        TALA_GOOGLE_CLIENT_SECRET: FAKE_GOOGLE_CREDENTIALS.clientSecret,
        TALA_GOOGLE_REFRESH_TOKEN: FAKE_GOOGLE_CREDENTIALS.refreshToken,
        TALA_GOOGLE_TOKEN_URL: `${base}/token`,
        TALA_GOOGLE_API_BASE: base,
        ...extra,
      };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
