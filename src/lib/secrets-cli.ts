/**
 * secrets-cli.ts — Command implementations for kimi-secrets CLI.
 */

import { Either } from "effect";
import { SecretsManager } from "./secrets-manager.ts";
import { auditSecretsStorage } from "./secrets-probe.ts";
import { runSecretsStorageGate, SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY } from "./secrets-gate.ts";
import { SecretRotationRequired, SecretPolicyViolation, SecretNotFound } from "./effect/errors.ts";
import {
  runSecretsCheck,
  runSecretsList,
  runSecretsRotate,
} from "./effect/secrets-runtime.ts";
import type { AnySecretKey, SecretCheckResult } from "./secrets-types.ts";
import { aggregateChecks } from "./health-check.ts";
import { inspectAgent } from "./inspect.ts";

function emitJson(value: unknown): void {
  process.stdout.write(`${inspectAgent(value)}\n`);
}

export interface SecretsCliOptions {
  projectRoot: string;
  json?: boolean;
  consumer?: string;
}

function parseKey(service: string, name: string): AnySecretKey {
  return { service, name };
}

export async function cmdSecretsStorage(opts: SecretsCliOptions): Promise<number> {
  const manager = new SecretsManager({ projectRoot: opts.projectRoot, onWarn: () => {} });
  const status = await manager.storageStatus();
  if (opts.json) {
    emitJson(status);
    return status.insecureSecretCount > 0 ? 1 : 0;
  }
  console.log(`platform:     ${status.platform}`);
  console.log(`backend:      ${status.backend}`);
  console.log(`security:     ${status.securityLevel}`);
  console.log(`libsecret:    ${status.libsecretAvailable ? "yes" : "no"}`);
  console.log(`mismatches:   ${status.insecureSecretCount}`);
  console.log(`env-fallback: ${status.envFallbackOptInCount}`);
  for (const w of status.warnings) console.warn(`  ⚠ ${w}`);
  return status.insecureSecretCount > 0 ? 1 : 0;
}

export async function cmdSecretsList(opts: SecretsCliOptions): Promise<number> {
  const manager = new SecretsManager({ projectRoot: opts.projectRoot, onWarn: () => {} });
  const rows = await runSecretsList(manager);
  if (opts.json) {
    emitJson(rows);
    return 0;
  }
  for (const row of rows) {
    const via = row.resolvedVia ? ` via ${row.resolvedVia}` : "";
    console.log(`${row.present ? "✓" : "✗"} ${row.key.service}/${row.key.name}${via}`);
  }
  return 0;
}

function printCheckRows(results: SecretCheckResult[]): void {
  for (const row of results) {
    const id = `${row.key.service}/${row.key.name}`;
    const stale =
      row.daysStale !== null && row.daysStale !== undefined ? ` (${row.daysStale}d)` : "";
    console.log(`${row.status.padEnd(16)} ${id}${stale}`);
    if (row.storageWarning) console.warn(`  ⚠ ${row.storageWarning}`);
  }
}

export async function cmdSecretsCheck(opts: SecretsCliOptions): Promise<number> {
  const manager = new SecretsManager({ projectRoot: opts.projectRoot });
  const gate = await runSecretsStorageGate(opts.projectRoot);
  const result = await runSecretsCheck(manager);

  if (opts.json) {
    emitJson({
      gate,
      check: Either.isRight(result) ? result.right : { error: result.left._tag },
    });
  } else {
    if (!gate.ok && !gate.skipped) {
      console.error(
        `gate: ${gate.message} [${gate.taxonomyId ?? SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY}]`
      );
    } else if (gate.skipped) {
      console.log(`gate: skipped (${gate.message})`);
    } else {
      console.log(`gate: ${gate.message}`);
    }

    if (Either.isRight(result)) {
      printCheckRows(result.right);
    } else if (result.left instanceof SecretRotationRequired) {
      console.error(
        `rotation required: ${result.left.service}/${result.left.name} (${result.left.daysStale ?? "?"}d stale)`
      );
    }
  }

  if (!gate.ok && !gate.skipped) return 1;
  if (Either.isLeft(result)) return 1;
  const mismatches = result.right.filter((r) => r.status === "storage_mismatch");
  return mismatches.length > 0 ? 1 : 0;
}

export async function cmdSecretsRotate(
  opts: SecretsCliOptions,
  service: string,
  name: string,
  newValue?: string
): Promise<number> {
  const manager = new SecretsManager({ projectRoot: opts.projectRoot });
  const key = parseKey(service, name);
  const result = await runSecretsRotate(manager, key, newValue);

  if (Either.isLeft(result)) {
    const err = result.left;
    const message =
      err instanceof SecretNotFound
        ? `secret not found: ${service}/${name}`
        : err instanceof SecretPolicyViolation
          ? `policy violation: ${err.reason}`
          : String(err);
    if (opts.json) emitJson({ ok: false, error: message });
    else console.error(message);
    return 1;
  }

  if (opts.json) emitJson({ ok: true, ...result.right });
  else
    console.log(
      `rotated ${service}/${name} → v${result.right.version} (${result.right.lastRotated})`
    );
  return 0;
}

export async function cmdSecretsDoctor(opts: SecretsCliOptions): Promise<number> {
  const checks = await auditSecretsStorage(opts.projectRoot);
  if (opts.json) {
    emitJson(checks);
    return checks.some((c) => c.status === "error") ? 1 : 0;
  }
  const report = aggregateChecks("kimi-secrets", checks);
  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    console.log(`${icon} ${check.name}: ${check.message}`);
  }
  return report.errorCount > 0 ? 1 : 0;
}

export async function cmdSecretsGate(opts: SecretsCliOptions): Promise<number> {
  const result = await runSecretsStorageGate(opts.projectRoot);
  if (opts.json) {
    emitJson(result);
    return result.ok ? 0 : 1;
  }
  if (result.skipped) {
    console.log(`skipped: ${result.message}`);
    return 0;
  }
  if (!result.ok) {
    console.error(`${result.message} [${result.taxonomyId}]`);
    return 1;
  }
  console.log(result.message);
  return 0;
}

export function printSecretsHelp(): void {
  console.log(`Usage: kimi-secrets <command> [args] [--json]

Commands:
  check              Policy + storage tier check (exits 1 on mismatch/stale)
  list               List registered secrets and presence (no values)
  storage            Show storage backend diagnostics
  gate               CI storage tier gate (Linux env-fallback)
  rotate <svc> <name> [--value <secret>]  Rotate a registered secret
  doctor             Storage backend health checks

Examples:
  kimi-secrets storage --json
  kimi-secrets check
  kimi-secrets rotate com.herdr.dashboard jwt-secret
  KIMI_SECRETS_STRICT_STORAGE=1 kimi-secrets check`);
}
