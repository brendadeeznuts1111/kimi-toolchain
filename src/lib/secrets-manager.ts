/**
 * secrets-manager.ts — Core SecretsManager wrapping Bun.secrets with policy
 * enforcement, audit logging, in-memory caching, and rotation support.
 *
 * @see secrets-types.ts for type definitions
 * @see secrets-policy.ts for policy loading/validation
 * @see secrets-audit.ts for audit trail
 */

import { Context, Effect, Layer } from "effect";
import { createLogger } from "./logger.ts";
import { secretsPolicyPath, secretsAuditPath } from "./paths.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import {
  loadSecretsPolicy,
  getPolicyEntry,
  getAllPolicyEntries,
  isStale,
  writeSecretsPolicy,
  todayDateString,
} from "./secrets-policy.ts";
import { appendSecretAudit, querySecretAudit } from "./secrets-audit.ts";
import { readSecretFromEnv } from "./secrets-env.ts";
import {
  buildStorageStatus,
  detectStorageBackend,
  effectiveStorageTier,
  allowsEnvFallback,
  envFallbackBackendWarning,
  isStorageTierMismatch,
  isStrictStorageEnabled,
  storageSecurityLevel,
  storageTierWarning,
  type StorageStatus,
} from "./secrets-storage.ts";
import { SecretNotFound, SecretPolicyViolation, SecretRotationRequired } from "./effect/errors.ts";
import type {
  AnySecretKey,
  SecretsBackend,
  SecretPolicyEntry,
  SecretAuditRecord,
  SecretCheckResult,
  SecretListResult,
  AuditQuery,
  SecretsPolicyDocument,
  SecretResolveSource,
  StorageBackend,
} from "./secrets-constants.ts";
import type { HealthCheck } from "./health-check.ts";

export interface ResolvedSecret {
  value: string | null;
  resolvedVia?: SecretResolveSource;
}

export interface SecretsManagerOptions {
  secrets?: SecretsBackend;
  policyPath?: string;
  auditPath?: string;
  projectRoot?: string;
  /** NODE_ENV-style policy environment name. */
  env?: string;
  /** Env var source for env-fallback tier (defaults to Bun.env). */
  envVars?: Record<string, string | undefined>;
  now?: () => Date;
  /** Override backend detection (tests). Defaults to detectStorageBackend(). */
  detectBackend?: () => Promise<StorageBackend>;
  /** Emit storage-tier warnings (defaults to createLogger warn). */
  onWarn?: (message: string) => void;
}

function defaultNow(): Date {
  return new Date();
}

function generateRandomSecret(): string {
  return Bun.randomUUIDv7("hex").replace(/-/g, "") + Bun.randomUUIDv7("hex").replace(/-/g, "");
}

function cacheKey(k: { service: string; name: string }): string {
  return `${k.service}:${k.name}`;
}

export class SecretsManager {
  private readonly backend: SecretsBackend;
  private readonly policyPath: string;
  private readonly auditPath: string;
  private readonly env: string;
  private readonly envVars: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly detectBackend: () => Promise<StorageBackend>;
  private readonly onWarn: (message: string) => void;
  private policyCache: SecretsPolicyDocument | null = null;
  private readonly valueCache = new Map<string, string>();
  private storageBackendCache: StorageBackend | null = null;
  private envFallbackWarned = false;

  constructor(opts: SecretsManagerOptions = {}) {
    this.backend = opts.secrets ?? Bun.secrets;

    const projectRoot = opts.projectRoot ?? Bun.cwd;
    this.policyPath = opts.policyPath ?? secretsPolicyPath(projectRoot);
    this.auditPath = opts.auditPath ?? secretsAuditPath();

    this.env = (opts.env ?? Bun.env.NODE_ENV ?? "development").toLowerCase();
    this.envVars = opts.envVars ?? Bun.env;
    this.now = opts.now ?? defaultNow;
    this.detectBackend = opts.detectBackend ?? detectStorageBackend;
    this.onWarn = opts.onWarn ?? ((message) => createLogger(Bun.argv, "secrets").warn(message));
  }

  async storageBackend(): Promise<StorageBackend> {
    if (this.storageBackendCache) return this.storageBackendCache;
    this.storageBackendCache = await this.detectBackend();
    return this.storageBackendCache;
  }

  async storageStatus(): Promise<StorageStatus> {
    let policy: SecretsPolicyDocument;
    try {
      policy = await this.ensurePolicy();
    } catch {
      policy = { $schema: "v1" };
    }
    const backend = await this.storageBackend();
    return buildStorageStatus(backend, getAllPolicyEntries(policy));
  }

  private async resolveSecretValue(
    service: string,
    name: string,
    entry: SecretPolicyEntry | null
  ): Promise<ResolvedSecret> {
    let value: string | null = null;
    let resolvedVia: SecretResolveSource | undefined;

    try {
      value = await this.backend.get({ service, name });
      if (value !== null) resolvedVia = "bun.secrets";
    } catch {
      value = null;
    }

    if (value === null && entry && allowsEnvFallback(entry)) {
      const fromEnv = readSecretFromEnv(service, name, this.envVars);
      if (fromEnv !== null) {
        value = fromEnv;
        resolvedVia = "env";
      }
    }

    return { value, resolvedVia };
  }

  private async warnStorageTier(
    backend: StorageBackend,
    service: string,
    name: string,
    entry: SecretPolicyEntry
  ): Promise<string | undefined> {
    const general = envFallbackBackendWarning(backend);
    if (general && !this.envFallbackWarned) {
      this.onWarn(general);
      this.envFallbackWarned = true;
    }

    const perSecret = storageTierWarning(backend, entry, service, name);
    if (perSecret) this.onWarn(perSecret);
    return perSecret;
  }

  private async ensurePolicy(): Promise<SecretsPolicyDocument> {
    if (this.policyCache) return this.policyCache;
    this.policyCache = await loadSecretsPolicy(this.policyPath);
    return this.policyCache;
  }

  private getEntry(service: string, name: string): SecretPolicyEntry | null {
    if (!this.policyCache) return null;
    return getPolicyEntry(this.policyCache, service, name, this.env);
  }

  private async recordAudit(record: Omit<SecretAuditRecord, "timestamp">): Promise<void> {
    let traceId: string | undefined;
    try {
      const trace = ensureProcessTrace();
      traceId = trace.traceId;
    } catch {
      traceId = Bun.randomUUIDv7();
    }
    const full: SecretAuditRecord = {
      timestamp: this.now().toISOString(),
      traceId,
      ...record,
    };
    try {
      await appendSecretAudit(this.auditPath, full);
    } catch {
      // Audit must never block secrets operations
    }
  }

  get(
    key: AnySecretKey,
    consumer: string
  ): Effect.Effect<string | null, SecretNotFound | SecretPolicyViolation> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const policy = yield* Effect.tryPromise({
        try: () => self.ensurePolicy(),
        catch: () =>
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer,
            reason: "secret_not_registered",
          }),
      });

      const entry = getPolicyEntry(policy, key.service, key.name, self.env);

      if (!entry) {
        void self.recordAudit({
          action: "get",
          service: key.service,
          name: key.name,
          consumer,
          success: false,
          errorReason: "secret_not_registered",
        });
        return yield* Effect.fail(
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer,
            reason: "secret_not_registered",
          })
        );
      }

      if (!entry.allowedConsumers.includes(consumer)) {
        void self.recordAudit({
          action: "get",
          service: key.service,
          name: key.name,
          consumer,
          success: false,
          errorReason: "consumer_not_allowed",
        });
        return yield* Effect.fail(
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer,
            reason: "consumer_not_allowed",
          })
        );
      }

      if (entry.expiresAt && self.now() > new Date(entry.expiresAt)) {
        void self.recordAudit({
          action: "get",
          service: key.service,
          name: key.name,
          consumer,
          success: false,
          errorReason: "secret_expired",
        });
        return yield* Effect.fail(
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer,
            reason: "secret_expired",
          })
        );
      }

      const staleInfo = isStale(entry, self.now());

      const storageBackend = yield* Effect.tryPromise({
        try: () => self.storageBackend(),
        catch: () => "env-fallback" as StorageBackend as never,
      });

      if (isStorageTierMismatch(storageBackend, entry)) {
        yield* Effect.tryPromise({
          try: () => self.warnStorageTier(storageBackend, key.service, key.name, entry),
          catch: () => undefined as never,
        });
        if (isStrictStorageEnabled()) {
          void self.recordAudit({
            action: "get",
            service: key.service,
            name: key.name,
            consumer,
            success: false,
            errorReason: "storage_tier_mismatch",
            storageBackend,
          });
          return yield* Effect.fail(
            new SecretPolicyViolation({
              service: key.service,
              name: key.name,
              consumer,
              reason: "storage_tier_mismatch",
            })
          );
        }
      }

      const ck = cacheKey(key);
      const cached = self.valueCache.get(ck);
      if (cached !== undefined) {
        void self.recordAudit({
          action: "get",
          service: key.service,
          name: key.name,
          consumer,
          success: true,
          stale: staleInfo.stale,
          daysStale: staleInfo.daysStale,
          version: entry.version,
          storageBackend,
        });
        return cached;
      }

      const resolved = yield* Effect.tryPromise({
        try: () => self.resolveSecretValue(key.service, key.name, entry),
        catch: () => ({ value: null }) as ResolvedSecret as never,
      });

      if (resolved.value === null) {
        void self.recordAudit({
          action: "get",
          service: key.service,
          name: key.name,
          consumer,
          success: false,
          errorReason: "SecretNotFound",
          stale: staleInfo.stale,
          daysStale: staleInfo.daysStale,
          version: entry.version,
          storageBackend,
        });
        return yield* Effect.fail(new SecretNotFound({ service: key.service, name: key.name }));
      }

      self.valueCache.set(ck, resolved.value);

      void self.recordAudit({
        action: "get",
        service: key.service,
        name: key.name,
        consumer,
        success: true,
        stale: staleInfo.stale,
        daysStale: staleInfo.daysStale,
        version: entry.version,
        storageBackend,
        resolvedVia: resolved.resolvedVia,
      });

      return resolved.value;
    });
  }

  set(key: AnySecretKey, value: string): Effect.Effect<void, SecretPolicyViolation> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => self.backend.set({ service: key.service, name: key.name, value }),
        catch: () =>
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer: "set",
            reason: "secret_not_registered",
          }),
      });

      self.valueCache.set(cacheKey(key), value);

      const entry = self.getEntry(key.service, key.name);
      void self.recordAudit({
        action: "set",
        service: key.service,
        name: key.name,
        consumer: "cli",
        success: true,
        version: entry?.version,
      });
    });
  }

  delete(key: AnySecretKey): Effect.Effect<boolean> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      let deleted: boolean;
      try {
        deleted = yield* Effect.tryPromise({
          try: () => self.backend.delete({ service: key.service, name: key.name }),
          catch: () => false as never,
        });
      } catch {
        deleted = false;
      }

      self.valueCache.delete(cacheKey(key));

      const entry = self.getEntry(key.service, key.name);
      void self.recordAudit({
        action: "delete",
        service: key.service,
        name: key.name,
        consumer: "cli",
        success: deleted,
        version: entry?.version,
      });

      return deleted;
    });
  }

  rotate(
    key: AnySecretKey,
    newValue?: string
  ): Effect.Effect<
    { version: number; lastRotated: string },
    SecretNotFound | SecretPolicyViolation
  > {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const policy = yield* Effect.tryPromise({
        try: () => self.ensurePolicy(),
        catch: () =>
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer: "rotate",
            reason: "secret_not_registered",
          }),
      });

      const entry = getPolicyEntry(policy, key.service, key.name, self.env);
      if (!entry) {
        return yield* Effect.fail(
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer: "rotate",
            reason: "secret_not_registered",
          })
        );
      }

      const value = newValue ?? generateRandomSecret();

      yield* Effect.tryPromise({
        try: () => self.backend.set({ service: key.service, name: key.name, value }),
        catch: () =>
          new SecretPolicyViolation({
            service: key.service,
            name: key.name,
            consumer: "rotate",
            reason: "secret_not_registered",
          }),
      });

      self.valueCache.set(cacheKey(key), value);

      const newVersion = entry.version + 1;
      const today = todayDateString();

      const serviceEntry = policy[key.service];
      if (serviceEntry && typeof serviceEntry === "object") {
        const nameEntry = (serviceEntry as Record<string, SecretPolicyEntry>)[key.name];
        if (nameEntry) {
          nameEntry.version = newVersion;
          nameEntry.lastRotated = today;
        }
      }

      try {
        yield* Effect.tryPromise({
          try: () => writeSecretsPolicy(self.policyPath, policy),
          catch: () => undefined as never,
        });
      } catch {
        // policy write-back failure is non-fatal
      }

      self.policyCache = policy;

      void self.recordAudit({
        action: "rotate",
        service: key.service,
        name: key.name,
        consumer: "rotate",
        success: true,
        version: newVersion,
      });

      return { version: newVersion, lastRotated: today };
    });
  }

  list(): Effect.Effect<SecretListResult[]> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      let policy: SecretsPolicyDocument;
      try {
        policy = yield* Effect.tryPromise({
          try: () => self.ensurePolicy(),
          catch: () => ({ $schema: "v1" }) as SecretsPolicyDocument as never,
        });
      } catch {
        policy = { $schema: "v1" } as SecretsPolicyDocument;
      }

      const entries = getAllPolicyEntries(policy);
      const results: SecretListResult[] = [];

      for (const { service, name, entry } of entries) {
        const resolved = yield* Effect.tryPromise({
          try: () => self.resolveSecretValue(service, name, entry),
          catch: () => ({ value: null }) as ResolvedSecret as never,
        });

        results.push({
          key: { service, name },
          present: resolved.value !== null,
          policy: entry,
          resolvedVia: resolved.resolvedVia,
        });
      }

      return results;
    });
  }

  check(): Effect.Effect<SecretCheckResult[], SecretRotationRequired> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const policy = yield* Effect.tryPromise({
        try: () => self.ensurePolicy(),
        catch: () => ({ $schema: "v1" }) as SecretsPolicyDocument as never,
      });

      const entries = getAllPolicyEntries(policy);
      const results: SecretCheckResult[] = [];
      const storageBackend = yield* Effect.tryPromise({
        try: () => self.storageBackend(),
        catch: () => "env-fallback" as StorageBackend as never,
      });

      for (const { service, name, entry } of entries) {
        const resolved = yield* Effect.tryPromise({
          try: () => self.resolveSecretValue(service, name, entry),
          catch: () => ({ value: null }) as ResolvedSecret as never,
        });

        const staleInfo = isStale(entry, self.now());
        const storageWarning = yield* Effect.tryPromise({
          try: () => self.warnStorageTier(storageBackend, service, name, entry),
          catch: () => undefined as never,
        });
        const storageMismatch = isStorageTierMismatch(storageBackend, entry);

        let status: SecretCheckResult["status"];
        if (resolved.value === null) {
          status = "missing";
        } else if (staleInfo.stale) {
          status = "stale";
        } else if (storageMismatch) {
          status = "storage_mismatch";
        } else {
          status = "ok";
        }

        results.push({
          key: { service, name },
          status,
          daysStale: staleInfo.daysStale,
          lastRotated: entry.lastRotated,
          rotationDays: entry.rotationDays,
          storageTier: effectiveStorageTier(entry),
          storageWarning,
          resolvedVia: resolved.resolvedVia,
          storageMismatch,
        });
      }

      void self.recordAudit({
        action: "check",
        service: "*",
        name: "*",
        consumer: "cli",
        success: true,
        storageBackend,
      });

      const firstStale = results.find((r) => r.status === "stale");
      if (firstStale) {
        return yield* Effect.fail(
          new SecretRotationRequired({
            service: firstStale.key.service,
            name: firstStale.key.name,
            lastRotated: firstStale.lastRotated ?? null,
            rotationDays: firstStale.rotationDays ?? 0,
            daysStale: firstStale.daysStale ?? null,
          })
        );
      }

      return results;
    });
  }

  audit(query: AuditQuery): Effect.Effect<SecretAuditRecord[]> {
    // eslint-disable-next-line no-this-alias
    const self = this;
    return Effect.tryPromise({
      try: () => querySecretAudit(self.auditPath, query),
      catch: () => [] as never,
    });
  }

  clearCache(): void {
    this.valueCache.clear();
    this.policyCache = null;
  }
}

/** Effect-facing API for {@link SecretsManager} — consumed via Context.Tag in Effect pipelines. */
export interface SecretsService {
  readonly get: (
    key: AnySecretKey,
    consumer: string
  ) => Effect.Effect<string | null, SecretNotFound | SecretPolicyViolation>;
  readonly set: (key: AnySecretKey, value: string) => Effect.Effect<void, SecretPolicyViolation>;
  readonly delete: (key: AnySecretKey) => Effect.Effect<boolean>;
  readonly rotate: (
    key: AnySecretKey,
    newValue?: string
  ) => Effect.Effect<
    { version: number; lastRotated: string },
    SecretNotFound | SecretPolicyViolation
  >;
  readonly list: () => Effect.Effect<SecretListResult[]>;
  readonly check: () => Effect.Effect<SecretCheckResult[], SecretRotationRequired>;
  readonly audit: (query: AuditQuery) => Effect.Effect<SecretAuditRecord[]>;
  readonly storageBackend: () => Effect.Effect<StorageBackend>;
  readonly storageStatus: () => Effect.Effect<StorageStatus>;
}

export class Secrets extends Context.Tag("Secrets")<Secrets, SecretsService>() {}

/** Layer factories: {@link SecretsLive} and {@link SecretsTest} in effect/secrets-service.ts */
export type SecretsLayer = Layer.Layer<Secrets>;

export const SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY = "secrets_storage_tier_mismatch";

export interface SecretsStorageGateResult {
  ok: boolean;
  message: string;
  taxonomyId?: string;
  backend?: string;
  insecureSecretCount?: number;
  skipped?: boolean;
}

export interface SecretsStorageGateOptions {
  detectBackend?: () => Promise<StorageBackend>;
}

export interface SecretsProbeOptions {
  detectBackend?: () => Promise<StorageBackend>;
}

async function policyBackedManager(
  projectRoot: string,
  detectBackend?: () => Promise<StorageBackend>
): Promise<SecretsManager | null> {
  const policyPath = secretsPolicyPath(projectRoot);
  if (!(await Bun.file(policyPath).exists())) return null;
  return new SecretsManager({
    projectRoot,
    policyPath,
    detectBackend,
    onWarn: () => {},
  });
}

export async function runSecretsStorageGate(
  projectRoot: string,
  opts: SecretsStorageGateOptions = {}
): Promise<SecretsStorageGateResult> {
  const manager = await policyBackedManager(projectRoot, opts.detectBackend);
  if (!manager) {
    return { ok: true, skipped: true, message: "secrets-policy.json5 missing — gate skipped" };
  }

  const status = await manager.storageStatus();
  if (status.backend !== "env-fallback") {
    return {
      ok: true,
      message: `${status.backend} backend (${status.securityLevel} security)`,
      backend: status.backend,
      insecureSecretCount: 0,
    };
  }
  if (status.insecureSecretCount === 0) {
    return {
      ok: true,
      message: `env-fallback with ${status.envFallbackOptInCount} opt-in secret(s)`,
      backend: status.backend,
      insecureSecretCount: 0,
    };
  }
  return {
    ok: false,
    message: `${status.insecureSecretCount} secret(s) lack storageTier: "env-fallback" on Linux env-fallback backend`,
    taxonomyId: SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY,
    backend: status.backend,
    insecureSecretCount: status.insecureSecretCount,
  };
}

export async function auditSecretsStorage(
  projectRoot: string,
  opts: SecretsProbeOptions = {}
): Promise<HealthCheck[]> {
  const manager = await policyBackedManager(projectRoot, opts.detectBackend);
  if (!manager) {
    return [
      {
        name: "secrets:policy",
        status: "warn",
        message: "secrets-policy.json5 missing",
        fixable: true,
        autoFix: "bun run sync",
      },
    ];
  }

  const status = await manager.storageStatus();
  const checks: HealthCheck[] = [
    {
      name: "secrets:storage-backend",
      status: status.securityLevel === "high" ? "ok" : "warn",
      message: `${status.backend} (${status.securityLevel} security) on ${status.platform}`,
      fixable: false,
    },
  ];

  if (process.platform === "linux") {
    checks.push({
      name: "secrets:libsecret",
      status: status.libsecretAvailable ? "ok" : "warn",
      message: status.libsecretAvailable
        ? "libsecret daemon reachable"
        : status.secretToolPresent
          ? "secret-tool present but daemon unavailable"
          : "secret-tool not on PATH — env-fallback only",
      fixable: false,
    });
  }

  if (status.insecureSecretCount > 0) {
    checks.push({
      name: "secrets:tier-mismatch",
      status: "warn",
      message: `${status.insecureSecretCount} secret(s) lack storageTier: "env-fallback" on env-fallback backend`,
      fixable: true,
      autoFix: 'Add storageTier: "env-fallback" to CI-only entries in secrets-policy.json5',
    });
  } else if (status.backend === "env-fallback" && status.envFallbackOptInCount === 0) {
    checks.push({
      name: "secrets:tier-mismatch",
      status: "warn",
      message: "env-fallback backend active but no env-fallback tier secrets registered",
      fixable: true,
      autoFix: 'Register CI secrets with storageTier: "env-fallback"',
    });
  } else {
    checks.push({
      name: "secrets:tier-mismatch",
      status: "ok",
      message:
        status.backend === "env-fallback"
          ? `${status.envFallbackOptInCount} env-fallback tier secret(s) registered`
          : `secure tier (${storageSecurityLevel(status.backend)})`,
      fixable: false,
    });
  }

  return checks;
}
