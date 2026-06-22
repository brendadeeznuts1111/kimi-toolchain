#!/usr/bin/env bun
/**
 * audit-all.ts — Run the full doctor audit suite in one process.
 *
 * Usage:
 *   bun run audit:all
 *   bun --cpu-prof --cpu-prof-interval=500 run scripts/audit-all.ts
 *   bun --cpu-prof --cpu-prof-interval 500 run audit:all
 */

import { join } from "path";
import { auditSecretLeaks } from "../src/doctor/secret-audit.ts";
import { checkSecretIsolation } from "../src/doctor/secret-isolation.ts";
import { auditHardcodedSecrets } from "../src/doctor/hardcoded-secret-audit.ts";
import { auditImageAssets } from "../src/lib/image-audit.ts";
import { auditKimiConfig, type ConfigAuditCheck } from "../src/lib/kimi-config-audit.ts";
import { homeDir } from "../src/lib/paths.ts";
import { scanImageFilesSync } from "../src/lib/globs.ts";

const ROOT = join(import.meta.dir, "..");
const JSON_MODE = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");

function countConfigStatus(checks: ConfigAuditCheck[], status: ConfigAuditCheck["status"]): number {
  return checks.filter((c) => c.status === status).length;
}

async function runAudits(): Promise<{
  leaks: Awaited<ReturnType<typeof auditSecretLeaks>>;
  isolation: Awaited<ReturnType<typeof checkSecretIsolation>>;
  hardcoded: Awaited<ReturnType<typeof auditHardcodedSecrets>>;
  images: Awaited<ReturnType<typeof auditImageAssets>>;
  config: Awaited<ReturnType<typeof auditKimiConfig>>;
  durationMs: number;
}> {
  const started = Bun.nanoseconds();
  const [leaks, isolation, hardcoded, images, config] = await Promise.all([
    auditSecretLeaks(ROOT),
    checkSecretIsolation(ROOT),
    auditHardcodedSecrets(ROOT),
    auditImageAssets({ projectRoot: ROOT, files: scanImageFilesSync(ROOT), entropyCheck: true }),
    auditKimiConfig(homeDir()),
  ]);
  const durationMs = Math.round((Bun.nanoseconds() - started) / 1_000_000);
  return { leaks, isolation, hardcoded, images, config, durationMs };
}

function renderReport(
  results: ReturnType<typeof runAudits> extends Promise<infer T> ? T : never,
  dryRun: boolean
): number {
  const { leaks, isolation, hardcoded, images, config, durationMs } = results;
  const configErrors = countConfigStatus(config, "error");
  const configWarnings = countConfigStatus(config, "warn");
  const violations =
    leaks.count + isolation.errorCount + hardcoded.count + images.findings.length + configErrors;

  if (JSON_MODE) {
    console.log(
      JSON.stringify(
        {
          mode: dryRun ? "dry-run" : "audit",
          violations,
          durationMs,
          secretLeaks: { count: leaks.count, scanned: leaks.scanned },
          secretIsolation: { errors: isolation.errorCount, issues: isolation.issues.length },
          hardcodedSecrets: { count: hardcoded.count, scanned: hardcoded.scanned },
          imageAudit: { findings: images.findings.length, filesScanned: images.filesScanned },
          configAudit: { errors: configErrors, warnings: configWarnings, checks: config.length },
        },
        null,
        2
      )
    );
  } else {
    console.log(`audit:all${dryRun ? " dry-run" : ""} — ${violations} violation(s) in ${durationMs}ms`);
    console.log(`  secret leaks: ${leaks.count} (${leaks.scanned} files scanned)`);
    console.log(`  secret isolation: ${isolation.errorCount} error(s)`);
    console.log(`  hardcoded secrets: ${hardcoded.count} (${hardcoded.scanned} files scanned)`);
    console.log(
      `  image audit: ${images.findings.length} finding(s) (${images.filesScanned} images)`
    );
    console.log(
      `  config audit: ${configErrors} error(s), ${configWarnings} warning(s) (${config.length} checks)`
    );
    if (dryRun) {
      console.log("(audit:all dry-run — no fixes applied)");
    }
  }

  return violations;
}

async function main(): Promise<number> {
  const results = await runAudits();
  return renderReport(results, DRY_RUN);
}

process.exit(await main());
