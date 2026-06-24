#!/usr/bin/env bun
/**
 * Fast check gate — lint names, typecheck, unit tests, release SSOT.
 *
 *   bun run check:fast
 */

import { $ } from "bun";

const ac = new AbortController();
process.on("SIGINT", () => ac.abort());
process.on("SIGTERM", () => ac.abort());

const steps = [
  { name: "lint:names", cmd: $`bun run lint:names` },
  { name: "typecheck", cmd: $`bun run typecheck` },
  { name: "test:unit", cmd: $`bun run test:unit` },
  { name: "validate:release-ssot", cmd: $`bun run validate:release-ssot -- --skip-blog-audit` },
];

let failed = false;
for (const { name, cmd } of steps) {
  if (ac.signal.aborted) {
    console.error(`\n✗ check:fast aborted (${name} skipped)`);
    process.exit(1);
  }
  try {
    await cmd;
  } catch {
    failed = true;
  }
}

if (failed) process.exit(1);
