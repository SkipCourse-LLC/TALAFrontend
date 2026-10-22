import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { validatePublicEnvironment } from "./src/shared/publicEnvironment.ts";

const BACKEND_MODES = ["api", "demo"];

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  validatePublicEnvironment(environment);
  const backend = environment.VITE_BACKEND_MODE;
  if (backend && !BACKEND_MODES.includes(backend))
    throw new Error(`VITE_BACKEND_MODE must be "api" or "demo".`);
  const apiProxy = {
    "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
  };
  return {
    plugins: [react()],
    // Relative assets + HashRouter work under both root and project subpaths.
    base: "./",
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
  };
});
