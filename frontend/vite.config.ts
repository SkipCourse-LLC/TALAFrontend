import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  resolveFirebaseConfiguration,
  validatePublicEnvironment,
} from "./src/backend/firebaseConfiguration.ts";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  validatePublicEnvironment(environment);
  if (mode === "firebase-test") {
    if (environment.VITE_BACKEND_MODE !== "firebase-test")
      throw new Error(
        "Configure the approved Firebase test environment before starting this mode.",
      );
    resolveFirebaseConfiguration(environment, "localhost");
  } else if (
    environment.VITE_BACKEND_MODE &&
    environment.VITE_BACKEND_MODE !== "demo"
  ) {
    resolveFirebaseConfiguration(environment, "localhost");
  }
  return {
    plugins: [react()],
    // Relative assets + HashRouter work under both root and project subpaths.
    base: "./",
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "firebase-firestore",
                test: /node_modules\/@firebase\/firestore/,
              },
            ],
          },
        },
      },
    },
  };
});
