#!/usr/bin/env bun
/**
 * template-bootstrap: bun install only — no secrets registry at template copy time.
 * kimi-dashboard template postinstall.
 *
 * Usage:
 *   bun run scripts/postinstall.ts
 *   bun run scripts/postinstall.ts --help
 */

if (Bun.argv.includes("--help")) {
  console.log("Installs dependencies and prints dashboard quickstart instructions.");
  process.exit(0);
}

const proc = Bun.spawn(["bun", "install"], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
await proc.exited;

console.log("✅ Dashboard ready. Start: bun run dev");
console.log("   Docs: docs/extend.md");
console.log("   Copy handlers from: examples/dashboard/src/handlers/");

export {};
