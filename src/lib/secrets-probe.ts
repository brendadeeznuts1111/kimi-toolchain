/**
 * secrets-probe.ts — Health checks for Bun.secrets storage backend and policy tier alignment.
 */

import type { HealthCheck } from "./health-check.ts";
import { SecretsManager } from "./secrets-manager.ts";
import { secretsPolicyPath } from "./paths.ts";
import { storageSecurityLevel } from "./secrets-storage.ts";
import type { StorageBackend } from "./secrets-types.ts";

function check(
  name: string,
  status: HealthCheck["status"],
  message: string,
  fixable = false,
  autoFix?: string
): HealthCheck {
  return { name, status, message, fixable, autoFix };
}

export interface SecretsProbeOptions {
  detectBackend?: () => Promise<StorageBackend>;
}

export async function auditSecretsStorage(
  projectRoot: string,
  opts: SecretsProbeOptions = {}
): Promise<HealthCheck[]> {
  const policyPath = secretsPolicyPath(projectRoot);
  if (!(await Bun.file(policyPath).exists())) {
    return [check("secrets:policy", "warn", "secrets-policy.json5 missing", true, "bun run sync")];
  }

  const manager = new SecretsManager({
    projectRoot,
    policyPath,
    detectBackend: opts.detectBackend,
    onWarn: () => {},
  });

  const status = await manager.storageStatus();
  const checks: HealthCheck[] = [];

  checks.push(
    check(
      "secrets:storage-backend",
      status.securityLevel === "high" ? "ok" : "warn",
      `${status.backend} (${status.securityLevel} security) on ${status.platform}`
    )
  );

  if (process.platform === "linux") {
    checks.push(
      check(
        "secrets:libsecret",
        status.libsecretAvailable ? "ok" : "warn",
        status.libsecretAvailable
          ? "libsecret daemon reachable"
          : status.secretToolPresent
            ? "secret-tool present but daemon unavailable"
            : "secret-tool not on PATH — env-fallback only"
      )
    );
  }

  if (status.insecureSecretCount > 0) {
    checks.push(
      check(
        "secrets:tier-mismatch",
        "warn",
        `${status.insecureSecretCount} secret(s) lack storageTier: "env-fallback" on env-fallback backend`,
        true,
        'Add storageTier: "env-fallback" to CI-only entries in secrets-policy.json5'
      )
    );
  } else if (status.backend === "env-fallback" && status.envFallbackOptInCount === 0) {
    checks.push(
      check(
        "secrets:tier-mismatch",
        "warn",
        "env-fallback backend active but no env-fallback tier secrets registered",
        true,
        'Register CI secrets with storageTier: "env-fallback"'
      )
    );
  } else {
    checks.push(
      check(
        "secrets:tier-mismatch",
        "ok",
        status.backend === "env-fallback"
          ? `${status.envFallbackOptInCount} env-fallback tier secret(s) registered`
          : `secure tier (${storageSecurityLevel(status.backend)})`
      )
    );
  }

  return checks;
}
