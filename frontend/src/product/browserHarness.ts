// Starts the real local TALA server in a child process for browser tests and
// talks to its fixture actions over IPC. Only fictional example.test data.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export type SyntheticRole = "student" | "parent" | "alumni" | "staff";
export interface SyntheticAccount {
  uid: string;
  name: string;
  email: string;
  password: string;
  role: SyntheticRole;
}
export interface IsolatedServer {
  /** Creates an account server-side (self sign-up is closed) without signing it in. */
  provisionAccount(role: SyntheticRole, name?: string): Promise<SyntheticAccount>;
  linkFamily(studentUid: string, parentUid: string): Promise<unknown>;
  call(action: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export async function startIsolatedServer(options: {
  /** Must be a fresh directory whose name starts with "tala-product-browser-". */
  dataDir: string;
  apiPort: number;
  webPort: number;
}): Promise<IsolatedServer> {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../../server/test/product-browser-server.cjs", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        NODE_ENV: "test",
        TALA_BROWSER_TEST_DATA_DIR: options.dataDir,
        TALA_BROWSER_TEST_API_PORT: String(options.apiPort),
        TALA_BROWSER_TEST_WEB_PORT: String(options.webPort),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const requests = new Map<string, Pending>();
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The isolated Node test server did not become ready."));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      const failure = new Error("The isolated Node test server exited.");
      reject(failure);
      for (const request of requests.values()) {
        clearTimeout(request.timeout);
        request.reject(failure);
      }
      requests.clear();
    });
    child.on(
      "message",
      (message: { ready?: boolean; id?: string; result?: unknown; error?: string }) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        }
        if (!message.id) return;
        const request = requests.get(message.id);
        requests.delete(message.id);
        if (!request) return;
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
      },
    );
  });
  const call = (action: string, input: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!child.connected) {
        reject(new Error("The isolated fixture server is unavailable."));
        return;
      }
      const id = randomUUID();
      const timeout = setTimeout(() => {
        requests.delete(id);
        reject(new Error(`The isolated fixture action ${action} timed out.`));
      }, 10_000);
      requests.set(id, { resolve, reject, timeout });
      child.send({ id, action, input });
    });
  await started;
  return {
    call,
    async provisionAccount(role, name = `Synthetic ${role}`) {
      const suffix = randomUUID();
      const account = {
        name,
        email: `${role}-${suffix}@example.test`,
        password: `Synthetic-only-${suffix}`,
        role,
      };
      const saved = (await call("provisionAccount", account)) as { uid: string };
      return { ...account, uid: saved.uid };
    },
    linkFamily: (studentUid, parentUid) =>
      call("linkFamily", {
        studentUid,
        parentUid,
        consentReference: "approved-synthetic-browser-reference",
      }),
    async close() {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
}
