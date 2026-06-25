/**
 * secrets-cli.ts — Command implementations for kimi-secrets CLI.
 */

import { Effect, Either } from "effect";
import { SecretsManager } from "./secrets-manager.ts";
import { auditSecretsStorage } from "./secrets-probe.ts";
import { runSecretsStorageGate, SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY } from "./secrets-gate.ts";
import { SecretRotationRequired, SecretPolicyViolation, SecretNotFound } from "./effect/errors.ts";
import type { AnySecretKey, SecretCheckResult } from "./secrets-types.ts";
import { createLogger, type Logger } from "./logger.ts";
import { inspectAgent } from "./inspect.ts";

function emitJson(value: unknown): void {
  process.stdout.write(`${inspectAgent(value)}\n`);
}

export interface SecretsCliOptions {
  projectRoot: string;
  json?: boolean;
  consumer?: string;
  logger?: Logger;
}

function resolveSecretsLogger(opts: SecretsCliOptions): Logger {
  return opts.logger ?? createLogger(Bun.argv, "kimi-secrets");
}

function parseKey(service: string, name: string): AnySecretKey {
  return { service, name };
}

export async function cmdSecretsStorage(opts: SecretsCliOptions): Promise<number> {
  const logger = resolveSecretsLogger(opts);
  const manager = new SecretsManager({ projectRoot: opts.projectRoot, onWarn: () => {} });
  const status = await manager.storageStatus();
  if (opts.json) {
    emitJson(status);
    return status.insecureSecretCount > 0 ? 1 : 0;
  }
  logger.line(`platform:     ${status.platform}`);
  logger.line(`backend:      ${status.backend}`);
  logger.line(`security:     ${status.securityLevel}`);
  logger.line(`libsecret:    ${status.libsecretAvailable ? "yes" : "no"}`);
  logger.line(`mismatches:   ${status.insecureSecretCount}`);
  logger.line(`env-fallback: ${status.envFallbackOptInCount}`);
  for (const w of status.warnings) logger.warn(w);
  return status.insecureSecretCount > 0 ? 1 : 0;
}

export function secretsListProgram(opts: SecretsCliOptions): Effect.Effect<number> {
  return Effect.gen(function* () {
    const logger = resolveSecretsLogger(opts);
    const manager = new SecretsManager({ projectRoot: opts.projectRoot, onWarn: () => {} });
    const rows = yield* manager.list();
    if (opts.json) {
      emitJson(rows);
      return 0;
    }
    for (const row of rows) {
      const via = row.resolvedVia ? ` via ${row.resolvedVia}` : "";
      logger.line(`${row.present ? "✓" : "✗"} ${row.key.service}/${row.key.name}${via}`);
    }
    return 0;
  });
}

function printCheckRows(logger: Logger, results: SecretCheckResult[]): void {
  for (const row of results) {
    const id = `${row.key.service}/${row.key.name}`;
    const stale =
      row.daysStale !== null && row.daysStale !== undefined ? ` (${row.daysStale}d)` : "";
    logger.line(`${row.status.padEnd(16)} ${id}${stale}`);
    if (row.storageWarning) logger.warn(row.storageWarning);
  }
}

export function secretsCheckProgram(opts: SecretsCliOptions): Effect.Effect<number> {
  return Effect.gen(function* () {
    const logger = resolveSecretsLogger(opts);
    const manager = new SecretsManager({ projectRoot: opts.projectRoot });
    const gate = yield* Effect.tryPromise({
      try: () => runSecretsStorageGate(opts.projectRoot),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    const result = yield* Effect.either(manager.check());

    if (opts.json) {
      emitJson({
        gate,
        check: Either.isRight(result) ? result.right : { error: result.left._tag },
      });
    } else {
      if (!gate.ok && !gate.skipped) {
        logger.error(
          `gate: ${gate.message} [${gate.taxonomyId ?? SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY}]`
        );
      } else if (gate.skipped) {
        logger.line(`gate: skipped (${gate.message})`);
      } else {
        logger.line(`gate: ${gate.message}`);
      }

      if (Either.isRight(result)) {
        printCheckRows(logger, result.right);
      } else if (result.left instanceof SecretRotationRequired) {
        logger.error(
          `rotation required: ${result.left.service}/${result.left.name} (${result.left.daysStale ?? "?"}d stale)`
        );
      }
    }

    if (!gate.ok && !gate.skipped) return 1;
    if (Either.isLeft(result)) return 1;
    const mismatches = result.right.filter((r) => r.status === "storage_mismatch");
    return mismatches.length > 0 ? 1 : 0;
  });
}

export function secretsRotateProgram(
  opts: SecretsCliOptions,
  service: string,
  name: string,
  newValue?: string
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const logger = resolveSecretsLogger(opts);
    const manager = new SecretsManager({ projectRoot: opts.projectRoot });
    const key = parseKey(service, name);
    const result = yield* Effect.either(manager.rotate(key, newValue));

    if (Either.isLeft(result)) {
      const err = result.left;
      const message =
        err instanceof SecretNotFound
          ? `secret not found: ${service}/${name}`
          : err instanceof SecretPolicyViolation
            ? `policy violation: ${err.reason}`
            : String(err);
      if (opts.json) emitJson({ ok: false, error: message });
      else logger.error(message);
      return 1;
    }

    if (opts.json) emitJson({ ok: true, ...result.right });
    else
      logger.line(
        `rotated ${service}/${name} → v${result.right.version} (${result.right.lastRotated})`
      );
    return 0;
  });
}

export async function cmdSecretsDoctor(opts: SecretsCliOptions): Promise<number> {
  const logger = resolveSecretsLogger(opts);
  const checks = await auditSecretsStorage(opts.projectRoot);
  if (opts.json) {
    emitJson(checks);
    return checks.some((c) => c.status === "error") ? 1 : 0;
  }
  return logger.runDoctor("kimi-secrets", checks);
}

export async function cmdSecretsGate(opts: SecretsCliOptions): Promise<number> {
  const logger = resolveSecretsLogger(opts);
  const result = await runSecretsStorageGate(opts.projectRoot);
  if (opts.json) {
    emitJson(result);
    return result.ok ? 0 : 1;
  }
  if (result.skipped) {
    logger.line(`skipped: ${result.message}`);
    return 0;
  }
  if (!result.ok) {
    logger.error(`${result.message} [${result.taxonomyId}]`);
    return 1;
  }
  logger.line(result.message);
  return 0;
}

export function printSecretsHelp(logger?: Logger): void {
  const log = logger ?? createLogger(Bun.argv, "kimi-secrets");
  log.line(`Usage: kimi-secrets <command> [args] [--json]

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
