#!/usr/bin/env bun
/**
 * scan-hardcoded-secrets.ts — Detect credential-like literals in source.
 *
 * Usage:
 *   bun run scripts/scan-hardcoded-secrets.ts
 *   bun run scripts/scan-hardcoded-secrets.ts --json
 *   bun run audit:hardcoded
 */

import { auditHardcodedSecrets } from "../src/doctor/hardcoded-secret-audit.ts";

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const DRY_RUN = args.includes("--dry-run");
const ROOT = args.find((a) => !a.startsWith("--")) ?? ".";

async function main(): Promise<number> {
  if (DRY_RUN) {
    const summary = {
      tool: "scan-hardcoded-secrets",
      mode: "dry-run",
      projectRoot: ROOT,
      wouldRun: "auditHardcodedSecrets scan for credential-like literals",
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`audit:hardcoded dry-run — would scan ${ROOT} for credential-like literals`);
    }
    return 0;
  }

  const { findings, count, scanned } = await auditHardcodedSecrets(ROOT);

  if (JSON_MODE) {
    console.log(JSON.stringify({ findings, count, scanned }, null, 2));
  } else {
    if (count === 0) {
      console.log(`✓ No hardcoded credential-like literals found (${scanned} files scanned)`);
    } else {
      console.log(`✗ ${count} hardcoded credential-like literal(s) found (${scanned} files scanned):\n`);
      for (const f of findings) {
        console.log(`  ${f.file}:${f.line} [${f.type}]`);
        console.log(`    ${f.snippet}`);
      }
      console.log(
        "\nMove secrets to Bun.secrets / env, or suppress intentional dev-only fallbacks with `// kimi-audit:ignore-hardcoded-secret`."
      );
    }
  }

  return count;
}

process.exit(await main());
