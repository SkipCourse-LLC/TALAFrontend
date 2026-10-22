import { knownApiErrorCode, TalaApiError } from "./errors";

export interface ApiRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: BodyInit;
  contentType?: string;
  accept?: string;
  expectedUser?: string;
  signal?: AbortSignal;
}
export interface HttpTransport {
  request<T>(
    path: string,
    request: ApiRequest,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  json<T>(
    path: string,
    request: ApiRequest,
    decode: (value: unknown) => T,
  ): Promise<T>;
}

function statusError(status: number): TalaApiError {
  const code =
    status === 401
      ? "AUTH_REQUIRED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 409
            ? "CONFLICT"
            : status === 400 || status === 422
              ? "VALIDATION"
              : status === 429
                ? "RATE_LIMITED"
                : "UNAVAILABLE";
  return new TalaApiError(code, status);
}

function safePath(path: string): string {
  let url: URL;
  try {
    url = new URL(path, "https://tala.invalid");
  } catch {
    throw new TalaApiError("VALIDATION");
  }
  if (
    !path.startsWith("/api/") ||
    /[\\\r\n#]/.test(path) ||
    url.origin !== "https://tala.invalid" ||
    !url.pathname.startsWith("/api/")
  )
    throw new TalaApiError("VALIDATION");
  return path;
}

/** Bound the complete body, not just Content-Length, before parsing private data. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (signal.aborted) throw new TalaApiError("CANCELLED");
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new TalaApiError("INVALID_RESPONSE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new TalaApiError("CANCELLED");
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new TalaApiError("INVALID_RESPONSE");
      chunks.push(next.value);
    }
    if (signal.aborted) throw new TalaApiError("CANCELLED");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function createHttpTransport(options: {
  getCsrfToken: (signal: AbortSignal) => Promise<string>;
  fetcher?: typeof fetch;
}): HttpTransport {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const request: HttpTransport["request"] = async (path, input, consume) => {
    safePath(path);
    if (input.signal?.aborted) throw new TalaApiError("CANCELLED");
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    try {
      const method = input.method ?? "GET";
      const headers = new Headers({
        Accept: input.accept ?? "application/json",
      });
      if (input.contentType) headers.set("Content-Type", input.contentType);
      if (input.expectedUser) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.expectedUser))
          throw new TalaApiError("INVALID_INPUT");
        headers.set("X-TALA-User", input.expectedUser);
      }
      if (method !== "GET") {
        const csrf = await options.getCsrfToken(controller.signal);
        if (!csrf || csrf.length > 512 || /[\r\n]/.test(csrf))
          throw new TalaApiError("CSRF_REQUIRED");
        headers.set("X-CSRF-Token", csrf);
      }
      if (controller.signal.aborted) throw new TalaApiError("CANCELLED");
      const response = await fetcher(path, {
        method,
        headers,
        body: input.body,
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "same-origin",
      });
      if (!response.ok) {
        let failure = statusError(response.status);
        try {
          const bytes = await readBoundedResponse(
            response,
            16 * 1024,
            controller.signal,
          );
          const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (
            raw &&
            typeof raw === "object" &&
            "error" in raw &&
            raw.error &&
            typeof raw.error === "object" &&
            "code" in raw.error
          ) {
            const code = knownApiErrorCode(raw.error.code);
            if (code) failure = new TalaApiError(code, response.status);
          }
        } catch {}
        throw failure;
      }
      const value = await consume(response, controller.signal);
      if (controller.signal.aborted) throw new TalaApiError("CANCELLED");
      return value;
    } catch (error) {
      if (timedOut) throw new TalaApiError("NETWORK");
      if (
        input.signal?.aborted ||
        (error &&
          typeof error === "object" &&
          "name" in error &&
          error.name === "AbortError")
      )
        throw new TalaApiError("CANCELLED");
      if (error instanceof TalaApiError) throw error;
      // Fetch errors can leak URLs or account data; never surface them.
      throw new TalaApiError("NETWORK");
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
    }
  };
  return {
    request,
    json: async (path, input, decode) =>
      request(path, input, async (response, signal) => {
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        )
          throw new TalaApiError("INVALID_RESPONSE");
        const bytes = await readBoundedResponse(
          response,
          2 * 1024 * 1024,
          signal,
        );
        try {
          return decode(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ) as unknown,
          );
        } catch (error) {
          if (error instanceof TalaApiError) throw error;
          throw new TalaApiError("INVALID_RESPONSE");
        }
      }),
  };
}
