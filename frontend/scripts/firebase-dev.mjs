import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
const frontend = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host",
    "127.0.0.1",
    "--port",
    "5176",
    "--strictPort",
  ],
  {
    cwd: frontend,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_BACKEND_MODE: "firebase-emulator",
      VITE_FIREBASE_PROJECT_ID: "demo-tala-local",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: "8080",
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5001",
      VITE_FIREBASE_PRODUCTION_APPROVED: "false",
      VITE_FIREBASE_TEST_APPROVED: "false",
      VITE_FIREBASE_TEST_PROJECT_ID: "",
      VITE_FIREBASE_TEST_STORAGE_BUCKET: "",
      VITE_FIREBASE_GOOGLE_ENABLED: "false",
      VITE_FIREBASE_GOOGLE_ACCOUNT_CREATION_APPROVED: "false",
      VITE_FIREBASE_TOTP_APPROVED: "false",
      VITE_DEMO_MODE: "false",
      VITE_DEMO_TOOLS: "false",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  process.stderr.write(
    "Could not start the local Firebase frontend. Run npm ci in frontend first.\n",
  );
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
