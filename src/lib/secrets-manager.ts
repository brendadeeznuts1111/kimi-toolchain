/**
 * secrets-manager.ts — Core SecretsManager wrapping Bun.secrets with policy
 * enforcement, audit logging, in-memory caching, and rotation support.
 *
 * @see secrets-types.ts for type definitions
 * @see secrets-policy.ts for policy loading/validation
 * @see secrets-audit.ts for audit trail
 */

import { Effect } from "effect";
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
} from "./secrets-types.ts";

export interface SecretsManagerOptions {
  secrets?: SecretsBackend;
  policyPath?: string;
  auditPath?: string;
  projectRoot?: string;
  env?: string;
  now?: () => Date;
}

function defaultNow(): Date {
  return new Date();
}

function generateRandomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cacheKey(k: { service: string; name: string }): string {
  return `${k.service}:${k.name}`;
}

export class SecretsManager {
  private readonly backend: SecretsBackend;
  private readonly policyPath: string;
  private readonly auditPath: string;
  private readonly env: string;
  private readonly now: () => Date;
  private policyCache: SecretsPolicyDocument | null = null;
  private readonly valueCache = new Map<string, string>();

  constructor(opts: SecretsManagerOptions = {}) {
    this.backend = opts.secrets ?? Bun.secrets;

    const projectRoot = opts.projectRoot ?? Bun.cwd;
    this.policyPath = opts.policyPath ?? secretsPolicyPath(projectRoot);
    this.auditPath = opts.auditPath ?? secretsAuditPath();

    this.env = (opts.env ?? Bun.env.NODE_ENV ?? "development").toLowerCase();
    this.now = opts.now ?? defaultNow;
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
      // trace not available
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
        });
        return cached;
      }

      let value: string | null;
      try {
        value = yield* Effect.tryPromise({
          try: () => self.backend.get({ service: key.service, name: key.name }),
          catch: () => null as never,
        });
      } catch {
        value = null;
      }

      if (value === null) {
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
        });
        return yield* Effect.fail(new SecretNotFound({ service: key.service, name: key.name }));
      }

      self.valueCache.set(ck, value);

      void self.recordAudit({
        action: "get",
        service: key.service,
        name: key.name,
        consumer,
        success: true,
        stale: staleInfo.stale,
        daysStale: staleInfo.daysStale,
        version: entry.version,
      });

      return value;
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
        let value: string | null = null;
        try {
          value = yield* Effect.tryPromise({
            try: () => self.backend.get({ service, name }),
            catch: () => null as never,
          });
        } catch {
          value = null;
        }

        results.push({
          key: { service, name },
          present: value !== null,
          policy: entry,
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

      for (const { service, name, entry } of entries) {
        let value: string | null = null;
        try {
          value = yield* Effect.tryPromise({
            try: () => self.backend.get({ service, name }),
            catch: () => null as never,
          });
        } catch {
          value = null;
        }

        const staleInfo = isStale(entry, self.now());

        let status: SecretCheckResult["status"];
        if (value === null) {
          status = "missing";
        } else if (staleInfo.stale) {
          status = "stale";
        } else {
          status = "ok";
        }

        results.push({
          key: { service, name },
          status,
          daysStale: staleInfo.daysStale,
          lastRotated: entry.lastRotated,
          rotationDays: entry.rotationDays,
        });
      }

      void self.recordAudit({
        action: "check",
        service: "*",
        name: "*",
        consumer: "cli",
        success: true,
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
