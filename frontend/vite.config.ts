import { schoolConfig } from "./src/config/schoolConfig.ts";
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
    !["demo", "api"].includes(environment.VITE_BACKEND_MODE)
  ) {
    resolveFirebaseConfiguration(environment, "localhost");
  }
  const localApiPort = process.env.TALA_LOCAL_API_PORT || "8787";
  if (!/^\d{4,5}$/.test(localApiPort) || Number(localApiPort) > 65535)
    throw new Error("Choose a valid local API port.");
  // The public site build (npm run build:hosting in the deploy workflow) sets
  // no VITE_* values. Compile the production API mode in, with demo mode and
  // demo tools off, so demo pages and sample data are left out of the bundle.
  // Builds that choose a mode explicitly (tests, demo, Firebase) are unchanged.
  const publicSiteDefaults =
    mode === "production" && !environment.VITE_BACKEND_MODE
      ? {
          "import.meta.env.VITE_BACKEND_MODE": JSON.stringify("api"),
          "import.meta.env.VITE_DEMO_MODE": JSON.stringify("false"),
          "import.meta.env.VITE_DEMO_TOOLS": JSON.stringify("false"),
        }
      : undefined;
  return {
    plugins: [
      react(),
      {
        name: "school-page-metadata",
        transformIndexHtml(html) {
          const {
            brand,
            location,
            publicContent: { seo },
          } = schoolConfig;
          const escapeHtml = (value: string) =>
            value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;");
          const structuredData = {
            "@context": "https://schema.org",
            "@type": "School",
            name: brand.name,
            alternateName: brand.shortName,
            url: brand.website,
            description: seo.structuredDataDescription,
            educationalLevel: seo.educationalLevel,
            knowsAbout: seo.knowsAbout,
            address: {
              "@type": "PostalAddress",
              addressLocality: location.city,
              addressRegion: location.region,
              addressCountry: location.country,
            },
          };
          return html
            .replace("%SCHOOL_THEME_COLOR%", () => escapeHtml(brand.themeColor))
            .replace("%SCHOOL_DESCRIPTION%", () =>
              escapeHtml(seo.homeDescription),
            )
            .replace("%SCHOOL_TITLE%", () =>
              escapeHtml(`${seo.homeTitle} | ${brand.name}`),
            )
            .replace("%SCHOOL_STRUCTURED_DATA%", () =>
              JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
            );
        },
      },
    ],
    define: publicSiteDefaults,
    // Relative assets + HashRouter work under both root and project subpaths.
    base: "./",
    // Dev and preview servers stay on this machine: the API trusts loopback
    // requests, so they must never be reachable from the network.
    server: {
      host: "127.0.0.1",
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${localApiPort}`,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${localApiPort}`,
          changeOrigin: false,
        },
      },
    },
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
