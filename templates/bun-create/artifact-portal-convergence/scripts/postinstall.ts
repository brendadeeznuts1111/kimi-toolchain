#!/usr/bin/env bun
/**
 * artifact-portal-convergence template postinstall.
 *
 * Usage:
 *   bun run scripts/postinstall.ts
 *   bun run scripts/postinstall.ts --help
 */

if (Bun.argv.includes("--help")) {
  console.log("Makes shell scripts executable and prints workspace quickstart instructions.");
  process.exit(0);
}

const scriptsDir = process.cwd() + "/scripts";
for await (const file of new Bun.Glob("*.sh").scan({ cwd: scriptsDir, onlyFiles: true })) {
  await Bun.spawn(["chmod", "+x", `${scriptsDir}/${file}`]).exited;
}

console.log("✅ Artifact Portal convergence workspace ready.");
console.log("   Offline publish: bun run portal:local");
console.log("   Convergence test: bun run verify");
console.log("   Install pre-push guard: bun run hooks:install");
console.log("   Docs: README.md");
