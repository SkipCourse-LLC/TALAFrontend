// Records every visible string and link target of a built TALA site.
//
// Usage (from the repository root, after `npm ci --prefix frontend`):
//   node docs/copy-check/copy-snapshot.mjs <builtDir> <out.json> [port]
//
// It serves <builtDir> (for example `public/` from `npm run build:hosting`)
// over plain HTTP. Every /api request gets a 404, as on Firebase Hosting
// without a backend. For each route it records the document title, meta
// description, visible text lines, visible links (text -> href [target]),
// image alt text (src with build hashes and data URIs shortened), visible
// button labels and aria-labels. Compare two snapshots with copy-diff.mjs.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";

// Playwright comes from the frontend's own dev dependencies.
const { chromium } = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
)("@playwright/test");

const [dir, out, portArg] = process.argv.slice(2);
if (!dir || !out) {
  console.error("Usage: node copy-snapshot.mjs <builtDir> <out.json> [port]");
  process.exit(2);
}
const port = Number(portArg || 4391);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.startsWith("/api/")) {
    res.writeHead(404);
    return res.end();
  }
  const file = normalize(join(dir, path === "/" ? "index.html" : path));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(join(dir, "index.html")));
  }
}).listen(port);

// Public routes plus the account entry points a visitor can reach.
const routes = [
  "/",
  "/about",
  "/learn-more",
  "/programs",
  "/programs?program=campus",
  "/programs?program=virtual",
  "/admissions",
  "/tuition",
  "/faq",
  "/contact",
  "/events",
  "/login",
  "/register",
  "/application",
  "/enroll",
  "/two-factor",
  "/payment",
  "/dashboard",
  "/no-such-page",
];
const shorten = (src) =>
  !src
    ? src
    : src.startsWith("data:")
      ? `data:sha256-${createHash("sha256")
          .update(src.replace(/%0D|\r/gi, ""))
          .digest("hex")
          .slice(0, 12)}`
      : src.replace(/-[\w-]{8}\./, ".");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const result = {};
for (const route of routes) {
  await page.goto(`http://127.0.0.1:${port}/#${route}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const snapshot = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return {
      url: location.hash,
      title: document.title,
      description:
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? null,
      text: document.body.innerText.split("\n").map(clean).filter(Boolean),
      links: [...document.querySelectorAll("a[href]")]
        .filter(visible)
        .map(
          (a) =>
            `${clean(a.innerText || a.getAttribute("aria-label"))} -> ${a.getAttribute("href")}${a.target ? ` [${a.target}]` : ""}`,
        ),
      images: [...document.querySelectorAll("img")].map((i) => ({
        alt: i.getAttribute("alt"),
        src: i.getAttribute("src"),
      })),
      buttons: [...document.querySelectorAll("button")]
        .filter(visible)
        .map((b) => clean(b.innerText || b.getAttribute("aria-label"))),
      ariaLabels: [...document.querySelectorAll("[aria-label]")]
        .filter(visible)
        .map((e) => e.getAttribute("aria-label")),
    };
  });
  snapshot.images = snapshot.images.map(
    ({ alt, src }) => `${alt} <- ${shorten(src)}`,
  );
  result[route] = snapshot;
}
await browser.close();
server.close();
await writeFile(out, JSON.stringify(result, null, 2));
console.log(`Wrote ${out} (${routes.length} routes).`);
