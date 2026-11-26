// Compares two snapshots from copy-snapshot.mjs.
//
// Usage: node docs/copy-check/copy-diff.mjs <before.json> <after.json>
//
// Prints each string or link that appears in one snapshot and not the other
// (counting repeats), per route and field, and exits 1 when anything differs.
// "-" lines exist only in <before>; "+" lines exist only in <after>.
import { readFileSync } from "node:fs";

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error("Usage: node copy-diff.mjs <before.json> <after.json>");
  process.exit(2);
}
const before = JSON.parse(readFileSync(beforeFile, "utf8"));
const after = JSON.parse(readFileSync(afterFile, "utf8"));
const fields = [
  "url",
  "title",
  "description",
  "text",
  "links",
  "images",
  "buttons",
  "ariaLabels",
];
const count = (list) =>
  list.reduce((map, s) => map.set(s, (map.get(s) || 0) + 1), new Map());
let differences = 0;
for (const route of new Set([...Object.keys(before), ...Object.keys(after)])) {
  for (const field of fields) {
    const left = count([].concat(before[route]?.[field] ?? []));
    const right = count([].concat(after[route]?.[field] ?? []));
    for (const [s, n] of left)
      if ((right.get(s) || 0) < n) {
        differences++;
        console.log(`${route} ${field} - ${s}`);
      }
    for (const [s, n] of right)
      if ((left.get(s) || 0) < n) {
        differences++;
        console.log(`${route} ${field} + ${s}`);
      }
  }
}
console.log(differences ? `${differences} differences` : "No differences.");
process.exitCode = differences ? 1 : 0;
