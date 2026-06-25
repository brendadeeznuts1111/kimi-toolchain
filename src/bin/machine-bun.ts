#!/usr/bin/env bun
/**
 * Machine Bun install policy audit (~ layer).
 * Canonical implementation — synced from kimi-toolchain.
 *
 * Usage:
 *   bun run src/bin/machine-bun.ts
 *   bun run src/bin/machine-bun.ts --json
 *   bun run src/bin/machine-bun.ts --strict
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";
import { createLogger } from "../lib/logger.ts";
import {
  auditMachineBunPolicy,
  machineCheckFailures,
  machineCheckWarnings,
} from "../lib/machine-bun-policy.ts";
import { readUserBunfigInstall } from "../lib/bunfig-redundancy.ts";
import { MACHINE_BUNFIG_LABEL } from "../lib/machine-bun-ssot.ts";

const logger = createLogger(Bun.argv, "machine-bun");
const strict = Bun.argv.includes("--strict");
const json = Bun.argv.includes("--json");

async function main(): Promise<void> {
  const audit = await auditMachineBunPolicy();
  const machine = await readUserBunfigInstall();
  const failures = machineCheckFailures(audit.checks);
  const warnings = machineCheckWarnings(audit.checks);
  const failed = failures.length;
  const warned = warnings.length;
  const ssot = {
    label: MACHINE_BUNFIG_LABEL,
    bunfigPath: machine.bunfigPath,
    linker: machine.install?.linker ?? null,
    globalStore: machine.install?.globalStore ?? null,
    cacheDir: machine.cacheDir,
  };

  if (json) {
    await writeStdoutLine(
      JSON.stringify(
        {
          tool: "machine-bun",
          ok: failed === 0 && (strict ? warned === 0 : true),
          applicable: audit.applicable,
          bunfigPath: audit.bunfigPath,
          ssot,
          checks: audit.checks,
          failures,
          warnings,
        },
        null,
        2
      )
    );
    process.exit(failed > 0 || (strict && warned > 0) ? 1 : 0);
    return;
  }

  if (!audit.applicable) {
    logger.info("Machine Bun policy (~/.bunfig.toml)");
    logger.info("────────────────────────────────────");
    for (const check of audit.checks) {
      logger.info(`✅ ${check.id} — ${check.detail}`);
    }
    logger.info("────────────────────────────────────");
    logger.info("Result: pass (machine layer n/a)");
    process.exit(0);
  }

  logger.info(`Machine Bun policy (${MACHINE_BUNFIG_LABEL})`);
  logger.info("────────────────────────────────────");
  logger.info(
    `SSOT — linker=${ssot.linker ?? "unset"} globalStore=${String(ssot.globalStore)} cache.dir=${ssot.cacheDir ?? "unset"}`
  );
  logger.info("────────────────────────────────────");
  for (const check of audit.checks) {
    const isWarn = !check.ok && (check.id === "frozenLockfile" || check.id === "minimumReleaseAge");
    const icon = check.ok ? "✅" : isWarn && !strict ? "⚠️" : "❌";
    logger.info(`${icon} ${check.id} — ${check.detail}`);
  }
  logger.info("────────────────────────────────────");
  if (failed === 0 && warned === 0) {
    logger.info("Result: pass");
    process.exit(0);
  }
  if (failed === 0) {
    logger.info(
      strict
        ? `Result: fail (${warned} warning(s) under --strict)`
        : `Result: warn (${warned} warning(s); use --strict to fail)`
    );
    process.exit(strict ? 1 : 0);
  }
  logger.info(
    strict
      ? `Result: fail (${failed} check(s))`
      : `Result: fail (${failed} check(s); ${warned} warning(s))`
  );
  process.exit(1);
}

if (isDirectRun(import.meta.path)) {
  await main();
}