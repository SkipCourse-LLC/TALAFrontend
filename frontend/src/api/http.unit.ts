import { expect, test } from "@playwright/test";
import { createHttpTransport } from "./http";
import { TalaApiError } from "./errors";

test("mutations use same-origin cookies and a memory-provided CSRF nonce", async () => {
  let requests = 0;
  const transport = createHttpTransport({
    getCsrfToken: async () => "synthetic-csrf-nonce",
    fetcher: async (_input, init) => {
      requests++;
      expect(init?.credentials).toBe("same-origin");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("X-CSRF-Token")).toBe("synthetic-csrf-nonce");
      expect(headers.has("Authorization")).toBe(false);
      return Response.json({ accepted: true });
    },
  });
  expect(
    await transport.json(
      "/api/action",
      { method: "POST", body: "{}", contentType: "application/json" },
      (value) => value,
    ),
  ).toEqual({ accepted: true });
  expect(requests).toBe(1);
});

test("external and normalized traversal paths cannot receive session cookies", async () => {
  let requests = 0;
  const transport = createHttpTransport({
    getCsrfToken: async () => "nonce",
    fetcher: async () => {
      requests++;
      return Response.json({});
    },
  });
  for (const path of [
    "https://other.example/api/session",
    "//other.example/api/session",
    "/api/../private",
    "/api/%2e%2e/private",
    "/api/session#fragment",
  ])
    await expect(
      transport.json(path, {}, (value) => value),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(requests).toBe(0);
});

test("an absent CSRF nonce blocks mutation before fetch, while reads need no nonce", async () => {
  let requests = 0;
  const transport = createHttpTransport({
    getCsrfToken: async () => "",
    fetcher: async () => {
      requests++;
      return Response.json({});
    },
  });
  await expect(
    transport.json("/api/action", { method: "POST" }, (value) => value),
  ).rejects.toMatchObject({ code: "CSRF_REQUIRED" });
  expect(requests).toBe(0);
  await transport.json("/api/session", {}, (value) => value);
  expect(requests).toBe(1);
});

test("abort prevents both queued work and consumption of an in-flight response", async () => {
  const controller = new AbortController();
  let requests = 0;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transport = createHttpTransport({
    getCsrfToken: async () => "nonce",
    fetcher: async (_input, init) => {
      requests++;
      started?.();
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true },
        ),
      );
    },
  });
  const pending = transport.json(
    "/api/session",
    { signal: controller.signal },
    (value) => value,
  );
  await ready;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  await expect(
    transport.json(
      "/api/session",
      { signal: controller.signal },
      (value) => value,
    ),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  expect(requests).toBe(1);
});

test("server diagnostics never become user-facing error messages", async () => {
  const privateDetail = "internal-account-and-provider-details";
  const transport = createHttpTransport({
    getCsrfToken: async () => "nonce",
    fetcher: async () =>
      Response.json(
        { error: { code: "FORBIDDEN", message: privateDetail } },
        { status: 403 },
      ),
  });
  try {
    await transport.json("/api/session", {}, (value) => value);
    throw new Error("Expected failure");
  } catch (error) {
    expect(error instanceof TalaApiError && error.code).toBe("FORBIDDEN");
    expect(
      error instanceof Error && error.message.includes(privateDetail),
    ).toBe(false);
  }
});

test("invalid JSON, oversized bodies and decoder failures cannot confirm success", async () => {
  for (const response of [
    new Response("not-json", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response("x".repeat(2 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "application/json" },
    }),
    Response.json({ invalid: true }),
  ]) {
    const transport = createHttpTransport({
      getCsrfToken: async () => "nonce",
      fetcher: async () => response,
    });
    await expect(
      transport.json("/api/session", {}, () => {
        throw new Error("Unexpected schema");
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  }
});
