/**
 * install-secure.ts — Secure install pipeline wrapping `bun install` with
 * SecretsManager-backed key injection, pre-flight secret health checks,
 * and audit trail integration.
 *
 * Pipeline phases:
 *   1. Pre-flight  — check() all registered secrets, warn on stale/missing
 *   2. Inject      — resolve required secrets and inject into env for child process
 *   3. Run         — spawn `bun install` (or `bun ci`) with the enriched env
 *   4. Audit       — record pipeline outcome to secrets audit trail
 *
 * @see secrets-manager.ts for the core SecretsManager
 * @see secrets-policy.json5 for secret registration and rotation policy
 */

import { Effect } from "effect";
import { SecretsManager, type SecretsManagerOptions } from "./secrets-manager.ts";
import { SecretPolicyViolation, SecretNotFound } from "./effect/errors.ts";
import type { SecretCheckResult, AnySecretKey } from "./secrets-types.ts";
import {
  runScannerPipeline,
  type ScannerPipelineOptions,
  type ScannerPipelineResult,
} from "./scanner-pipeline.ts";

// ── Types ────────────────────────────────────────────────────────────

export type InstallMode = "install" | "ci" | "add" | "update";

export interface InstallSecureOptions extends SecretsManagerOptions {
  /** CLI args to pass through to `bun install` (e.g. ["--frozen-lockfile"]). */
  args?: string[];
  /** Which install mode to use. */
  mode?: InstallMode;
  /** Secrets required for this install run. If missing, pipeline aborts. */
  requiredSecrets?: Array<{ key: AnySecretKey; consumer: string }>;
  /** Skip the pre-flight check() if true (e.g. for dry-run). */
  skipPreflight?: boolean;
  /** Don't actually spawn bun install — just validate and report. */
  dryRun?: boolean;
  /** Override the bun binary path (defaults to "bun"). */
  bunBin?: string;
  /** Scanner pipeline options. If provided, runs vulnerability scan before install. */
  scanner?: ScannerPipelineOptions;
}

export interface InstallSecureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  preflight: PreflightResult;
  injectedSecrets: string[];
  scanner?: ScannerPipelineResult;
}

export interface PreflightResult {
  ok: boolean;
  results: SecretCheckResult[];
  warnings: string[];
  rotationRequired: string[];
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_BUN_BIN = "bun";
const SCANNER_CONSUMER = "bun-install";

// ── Preflight ────────────────────────────────────────────────────────

/**
 * Run a pre-flight health check on all registered secrets.
 * Returns warnings for stale/missing secrets but does not abort —
 * only `requiredSecrets` failures cause an abort.
 */
export function runPreflight(manager: SecretsManager): Effect.Effect<PreflightResult> {
  return Effect.gen(function* () {
    const either = yield* manager.check().pipe(Effect.either);

    const warnings: string[] = [];
    const rotationRequired: string[] = [];
    let checkResults: SecretCheckResult[] = [];

    if (either._tag === "Left") {
      const err = either.left;
      rotationRequired.push(`${err.service}:${err.name} (${err.daysStale ?? "?"} days stale)`);
    } else {
      checkResults = either.right;
      for (const r of checkResults) {
        const label = `${r.key.service}:${r.key.name}`;
        if (r.status === "missing") {
          warnings.push(`Missing: ${label}`);
        } else if (r.status === "stale") {
          warnings.push(
            `Stale: ${label} (${r.daysStale ?? "?"} days, rotation every ${r.rotationDays ?? "?"} days)`
          );
          rotationRequired.push(label);
        }
      }
    }

    const ok = warnings.length === 0 && rotationRequired.length === 0;

    return { ok, results: checkResults, warnings, rotationRequired };
  });
}

// ── Secret Injection ─────────────────────────────────────────────────

/**
 * Resolve required secrets from the SecretsManager and return them as
 * env var key-value pairs for injection into the child process.
 *
 * Uses the secret `name` as the env var name, uppercased and with hyphens
 * replaced by underscores (e.g. "cloudflare-api-token" → "CLOUDFLARE_API_TOKEN").
 */
export function resolveSecretsForEnv(
  manager: SecretsManager,
  required: Array<{ key: AnySecretKey; consumer: string }>
): Effect.Effect<Array<{ envVar: string; value: string }>, SecretNotFound | SecretPolicyViolation> {
  return Effect.gen(function* () {
    const resolved: Array<{ envVar: string; value: string }> = [];

    for (const { key, consumer } of required) {
      const value = yield* manager.get(key, consumer);
      if (value === null) {
        return yield* Effect.fail(new SecretNotFound({ service: key.service, name: key.name }));
      }
      const envVar = key.name.toUpperCase().replace(/-/g, "_");
      resolved.push({ envVar, value });
    }

    return resolved;
  });
}

// ── Pipeline ─────────────────────────────────────────────────────────

/**
 * Run the secure install pipeline:
 *   1. Pre-flight check
 *   2. Vulnerability scan (if scanner options provided)
 *   3. Resolve and inject required secrets
 *   4. Spawn `bun install` (or `bun ci` / `bun add` / `bun update`)
 *   5. Record audit
 */
export function runInstallSecure(
  opts: InstallSecureOptions = {}
): Effect.Effect<InstallSecureResult, SecretNotFound | SecretPolicyViolation> {
  const manager = new SecretsManager(opts);
  const mode = opts.mode ?? "install";
  const args = opts.args ?? [];
  const bunBin = opts.bunBin ?? DEFAULT_BUN_BIN;
  const required = opts.requiredSecrets ?? [];

  return Effect.gen(function* () {
    // Phase 1: Pre-flight
    let preflight: PreflightResult;
    if (opts.skipPreflight) {
      preflight = { ok: true, results: [], warnings: [], rotationRequired: [] };
    } else {
      preflight = yield* runPreflight(manager);
    }

    // Phase 2: Vulnerability scan (if scanner options provided)
    let scannerResult: ScannerPipelineResult | undefined;
    if (opts.scanner) {
      scannerResult = yield* Effect.tryPromise({
        try: () => runScannerPipeline(opts.scanner!),
        catch: () => new Error("Scanner pipeline failed") as never,
      });
    }

    // Phase 3: Resolve required secrets
    let injectedSecrets: string[] = [];
    let extraEnv: Record<string, string> = {};

    if (required.length > 0) {
      const resolved = yield* resolveSecretsForEnv(manager, required);
      injectedSecrets = resolved.map((r) => r.envVar);
      extraEnv = Object.fromEntries(resolved.map((r) => [r.envVar, r.value]));
    }

    // Phase 4: Run bun install
    let exitCode = 0;
    let stdout = "";
    let stderr = "";

    if (!opts.dryRun) {
      const cmd = mode === "install" ? [bunBin, "install", ...args] : [bunBin, mode, ...args];

      const result = yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn({
            cmd,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...Bun.env, ...extraEnv },
          });
          const [out, err] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          const code = await proc.exited;
          return { code, out, err };
        },
        catch: () => new Error(`Failed to spawn ${bunBin}`) as never,
      });
      exitCode = result.code;
      stdout = result.out;
      stderr = result.err;
    }

    // Phase 5: Audit (fire-and-forget via manager)
    // The manager's recordAudit is called internally by check() and get(),
    // but we also want a top-level pipeline audit record.
    void manager.audit({
      action: "check",
      service: "*",
      name: "*",
      consumer: SCANNER_CONSUMER,
    });

    return { exitCode, stdout, stderr, preflight, injectedSecrets, scanner: scannerResult };
  });
}

// ── Convenience ──────────────────────────────────────────────────────

/**
 * Quick helper: check all secrets and print a human-readable summary.
 * Useful for `kimi-secrets check` CLI subcommand.
 */
export async function quickCheck(opts: SecretsManagerOptions = {}): Promise<PreflightResult> {
  const manager = new SecretsManager(opts);
  return Effect.runPromise(runPreflight(manager)).catch(
    (err): PreflightResult => ({
      ok: false,
      results: [],
      warnings: [`Check failed: ${err instanceof Error ? err.message : String(err)}`],
      rotationRequired: [],
    })
  );
}
