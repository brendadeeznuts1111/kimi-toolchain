#!/usr/bin/env bun
/**
 * Bun purity check — scans for forbidden node:* imports.
 * Run: bun run lint:purity
 */

import { Glob } from "bun";

const FORBIDDEN = [
  /from ["']node:(crypto|http|https|net|dgram|tls|zlib)["']/,
  /from ["']node:fs\/promises["']/,
  /require\(["']node:(crypto|http)/,
];

const glob = new Glob("src/**/*.{ts,tsx}");
let violations = 0;

for await (const file of glob.scan(".")) {
  const content = await Bun.file(file).text();
  for (const pattern of FORBIDDEN) {
    if (pattern.test(content)) {
      console.error(`[PURITY] ${file}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} Bun purity violations found.`);
  process.exit(1);
}
console.log("Bun purity check passed.");
