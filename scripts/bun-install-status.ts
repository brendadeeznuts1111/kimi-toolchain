#!/usr/bin/env bun
/**
 * Print the Bun install SSOT and current policy alignment.
 *
 * Usage:
 *   bun run bun-install:status
 *   bun run bun-install:status --json
 */

import { join, resolve } from "path";
import { auditBunInstallConfig, formatInstallPolicyReport } from "../src/lib/bun-install-config.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const json = args.includes("--json");

function projectRoot(): string {
  const index = args.findIndex((arg) => arg === "--project");
  if (index >= 0) {
    const next = args[index + 1];
    if (!next) throw new Error("--project requires a path");
    return resolve(process.cwd(), next);
  }
  const inline = args.find((arg) => arg.startsWith("--project="));
  if (inline) return resolve(process.cwd(), inline.slice("--project=".length));
  return REPO_ROOT;
}

async function main(): Promise<void> {
  const report = await auditBunInstallConfig(projectRoot());

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatInstallPolicyReport(report).join("\n"));
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
