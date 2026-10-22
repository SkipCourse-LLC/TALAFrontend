import assert from "node:assert/strict";

/** Cookie jar for HTTP tests. */
export class SyntheticHttpClient {
  constructor(baseUrl, origin = "http://127.0.0.1:5173") {
    const url = new URL(baseUrl);
    assert.equal(url.hostname, "127.0.0.1", "Tests may contact loopback only");
    this.baseUrl = url.origin;
    this.origin = origin;
    this.cookies = new Map();
    this.csrfToken = "";
    this.expectedUid = "";
    this.lastSetCookies = [];
  }

  async bootstrap() {
    const response = await this.request("/api/session");
    assert.equal(response.status, 200, "Session bootstrap should succeed");
    assert.equal(typeof response.json?.csrfToken === "string", true);
    this.csrfToken = response.json.csrfToken;
    return response;
  }

  async request(path, options = {}) {
    assert.equal(path.startsWith("/api/"), true);
    assert.equal(new URL(path, this.baseUrl).origin, this.baseUrl);
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    headers.set("Origin", options.origin ?? this.origin);
    if (this.expectedUid && !headers.has("X-TALA-User"))
      headers.set("X-TALA-User", this.expectedUid);
    if (this.cookies.size)
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    if (
      method !== "GET" &&
      options.csrf !== false &&
      !headers.has("X-CSRF-Token")
    )
      headers.set("X-CSRF-Token", this.csrfToken);
    let body = options.body;
    if (Object.hasOwn(options, "json")) {
      body = JSON.stringify(options.json);
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    this.lastSetCookies = response.headers.getSetCookie();
    for (const setCookie of this.lastSetCookies) {
      const [entry] = setCookie.split(";");
      const separator = entry.indexOf("=");
      const name = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(setCookie))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let json;
    if (
      /^application\/json(?:;|$)/i.test(
        response.headers.get("Content-Type") ?? "",
      )
    )
      json = JSON.parse(bytes.toString("utf8"));
    if (typeof json?.csrfToken === "string") this.csrfToken = json.csrfToken;
    if (json && Object.hasOwn(json, "session"))
      this.expectedUid = json.session?.uid ?? "";
    return { status: response.status, headers: response.headers, json, bytes };
  }

  copy() {
    const client = new SyntheticHttpClient(this.baseUrl, this.origin);
    client.cookies = new Map(this.cookies);
    client.csrfToken = this.csrfToken;
    client.expectedUid = this.expectedUid;
    return client;
  }
}

export function assertNoPrivateLocation(value) {
  const serialized = JSON.stringify(value);
  assert.equal(
    /(?:storagePath|downloadUrl|signedUrl|passwordHash|sessionHash|csrfHash)/i.test(
      serialized,
    ),
    false,
    "Public DTOs must not expose private locations or authentication storage",
  );
}

/** Start an isolated application on an ephemeral loopback port. */
export async function startIsolatedApplication(
  createApplication,
  { prefix = "tala-http-test-", origin = "http://127.0.0.1:5173" } = {},
) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dataDir = await mkdtemp(join(tmpdir(), prefix));
  const application = createApplication({ dataDir, allowedOrigins: [origin] });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    application,
    dataDir,
    url: `http://127.0.0.1:${application.server.address().port}`,
    async close() {
      try {
        await application.close();
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}

/** Register a synthetic account; optionally promote it to operator. */
export async function registerSyntheticAccount(
  context,
  accountType = "student",
  { operator = false } = {},
) {
  const client = new SyntheticHttpClient(context.url);
  await client.bootstrap();
  const suffix = crypto.randomUUID();
  const account = {
    name: `Synthetic ${accountType}`,
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
    accountType,
  };
  const response = await client.request("/api/auth/register", {
    method: "POST",
    json: account,
  });
  assert.equal(response.status, 201, "Synthetic registration should succeed");
  if (operator) context.application.operator.promote(account.email);
  return { client, account, user: response.json.session };
}
