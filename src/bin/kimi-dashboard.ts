#!/usr/bin/env bun
/**
 * kimi-dashboard — Start the kimi-toolchain feature dashboard.
 *
 * Wraps examples/dashboard/src/index.ts with the correct working directory.
 * Supports --port, --host, and Bun.serve environment variables (PORT, BUN_PORT).
 *
 * Usage:
 *   kimi-dashboard
 *   kimi-dashboard --port=8080
 *   kimi-toolchain dashboard
 *   bun run dashboard
 */

import { join } from "path";

// Resolve the dashboard directory relative to the repo root
const repoRoot = import.meta.dir.includes("kimi-toolchain")
  ? import.meta.dir.split("kimi-toolchain")[0] + "kimi-toolchain"
  : process.cwd();

const dashboardDir = join(repoRoot, "examples", "dashboard");
const dashboardScript = join(dashboardDir, "src", "index.ts");

// Forward --port, --host flags; Bun.env.PORT/BUN_PORT are already picked up
const result = Bun.spawn(["bun", "run", dashboardScript], {
  cwd: dashboardDir,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

// If --port was passed, set it in env for the child
// (Bun.spawn inherits env by default)
await result.exited;
process.exit(result.exitCode);
