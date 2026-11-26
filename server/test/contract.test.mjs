import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// SCRUM-88 T4-2: contract.json is the agreed API surface. This fails as soon as
// a route is added to, or removed from, the server without updating the contract.
const source = await readFile(new URL("../application.cjs", import.meta.url), "utf8");
const contract = JSON.parse(await readFile(new URL("../contract.json", import.meta.url), "utf8"));

const normalize = (path) => path.replace(/:[A-Za-z]+/g, ":param");

function serverRoutes() {
  const routes = new Set();
  for (const line of source.split(/\r?\n/)) {
    const method = /req\.method === "([A-Z]+)"/.exec(line)?.[1];
    if (!method) continue;
    for (const exact of line.matchAll(/route === "\/api(\/[^"]*)"/g)) routes.add(`${method} ${exact[1]}`);
    for (const pattern of line.matchAll(/(?:route\.match\(|&& )\/\^\\\/api(.*?)\$\/(?:\)|\.test\(route\))/g)) {
      const path = pattern[1].replaceAll("\\/", "/").replace(/\([^)]*\)/g, ":param").replaceAll("[^/]+", ":param");
      routes.add(`${method} ${path}`);
    }
  }
  return routes;
}

test("T4-2 every server route is in contract.json and every contract route is served", () => {
  const served = serverRoutes();
  const agreed = new Set(contract.routes.map((route) => `${route.method} ${normalize(route.path)}`));
  assert.ok(served.size > 50, `Route extraction looks broken: found only ${served.size} routes`);
  const missingFromContract = [...served].filter((route) => !agreed.has(route)).sort();
  const notServed = [...agreed].filter((route) => !served.has(route)).sort();
  assert.deepEqual(missingFromContract, [], `Add these server routes to contract.json:\n${missingFromContract.join("\n")}`);
  assert.deepEqual(notServed, [], `These contract.json routes have no server handler:\n${notServed.join("\n")}`);
});

test("T4-2 contract.json describes every route it lists", () => {
  for (const route of contract.routes) {
    assert.match(route.method, /^(GET|POST|PUT|PATCH|DELETE)$/, `${route.path} needs an HTTP method`);
    assert.match(route.path, /^\//, `${route.method} ${route.path} must start with /`);
    assert.ok(route.response !== undefined, `${route.method} ${route.path} needs a response description`);
  }
  assert.equal(new Set(contract.routes.map((route) => `${route.method} ${route.path}`)).size, contract.routes.length, "Each route appears once");
});
