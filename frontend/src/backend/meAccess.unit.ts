import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dashboardPath, fetchMeAccess, ME_ACCESS_URL } from "./meAccess";

const user = { uid: "u1", getIdToken: async () => "firebase-token" };
const allowed = {
  uid: "u1",
  school: "tala",
  role: "student",
  email_verified: true,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("sends the Firebase bearer token to the function's app path", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    expect(input).toBe(ME_ACCESS_URL);
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer firebase-token" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    return response(allowed);
  };
  expect(
    await fetchMeAccess(user, new AbortController().signal, fetcher),
  ).toEqual(allowed);
});

test("only verified matching TALA users with supported roles enter their dashboard", async () => {
  for (const [role, path] of [
    ["student", "/dashboard/student"],
    ["parent", "/dashboard/parent"],
    ["talaadmin", "/dashboard/admin"],
  ] as const) {
    const result = await fetchMeAccess(
      user,
      new AbortController().signal,
      async () => response({ ...allowed, role }),
    );
    expect(dashboardPath(result.role)).toBe(path);
  }
  for (const data of [
    { ...allowed, uid: "another" },
    { ...allowed, school: "other" },
    { ...allowed, role: "admin" },
    { ...allowed, role: "provider" },
    { ...allowed, email_verified: false },
    { ...allowed, email_verified: "true" },
    null,
    [],
    {},
  ]) {
    await expect(
      fetchMeAccess(user, new AbortController().signal, async () =>
        response(data),
      ),
    ).rejects.toThrow();
  }
  await expect(
    fetchMeAccess(user, new AbortController().signal, async () =>
      response(allowed, 403),
    ),
  ).rejects.toThrow();
  await expect(
    fetchMeAccess(user, new AbortController().signal, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow();
});

test("hosting CSP permits only the intended access function origin", () => {
  const config = JSON.parse(readFileSync("../firebase.json", "utf8")) as {
    hosting: Array<{
      target: string;
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    }>;
  };
  for (const target of ["tala", "taladev"]) {
    const policy = config.hosting
      .find((entry) => entry.target === target)
      ?.headers.flatMap((entry) => entry.headers)
      .find((entry) => entry.key === "Content-Security-Policy")?.value;
    const connect = policy
      ?.split(";")
      .find((entry) => entry.trim().startsWith("connect-src "));
    expect(connect?.split(/\s+/)).toContain(new URL(ME_ACCESS_URL).origin);
    expect(connect).not.toContain("*.cloudfunctions.net");
  }
});

test("aborting an in-flight token or service request cannot authorize an old user", async () => {
  const abort = new AbortController();
  let release!: (token: string) => void;
  const delayedUser = {
    uid: "u1",
    getIdToken: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  };
  let requests = 0;
  const result = fetchMeAccess(delayedUser, abort.signal, async () => {
    requests++;
    return response(allowed);
  });
  abort.abort();
  release("old-token");
  await expect(result).rejects.toThrow();
  expect(requests).toBe(0);
});
