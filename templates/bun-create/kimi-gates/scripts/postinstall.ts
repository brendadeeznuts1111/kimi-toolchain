#!/usr/bin/env bun
/**
 * template-bootstrap: bun install only — no secrets registry at template copy time.
 * kimi-gates template postinstall.
 *
 * Usage:
 *   bun run scripts/postinstall.ts
 *   bun run scripts/postinstall.ts --help
 */

if (Bun.argv.includes("--help")) {
  console.log("Installs dependencies and prints gate loop quickstart instructions.");
  process.exit(0);
}

const proc = Bun.spawn(["bun", "install"], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
await proc.exited;

console.log("✅ Gate loop ready. Add gates to src/gates/");
console.log("   Run: bun run gate:all");
console.log("   Plan: bun run gate:plan");
console.log("   Graph: bun run gate:graph");

export {};
