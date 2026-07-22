/**
 * index.ts — Bun install security scanner entry (OSV-backed).
 *
 * Loaded by Bun's package manager via `[install.security] scanner` in bunfig.toml
 * (referenced by relative path — Bun rejects scanners that are workspace deps).
 * Bun imports this module in a subprocess and calls `scanner.scan({ packages })`
 * before installing packages.
 *
 * Configuration (environment):
 * - `KIMI_SECURITY_SCANNER_TIMEOUT_MS` — OSV request timeout (default 5000).
 * - `KIMI_SECURITY_SCANNER_OUTAGE_POLICY` — "warn" (default) emits a warn advisory on
 *   OSV outage; "ignore" returns no advisories (use in non-TTY CI, where any warn
 *   cancels the install).
 *
 * @see https://bun.com/docs/pm/security-scanner-api
 */

import { fetchWithTimeout } from "../../../src/lib/utils.ts";
import {
  scanPackages,
  SCANNER_DEFAULT_TIMEOUT_MS,
  type OutagePolicy,
} from "../../../src/lib/security-scanner.ts";

function timeoutMsFromEnv(): number {
  const raw = Bun.env.KIMI_SECURITY_SCANNER_TIMEOUT_MS;
  if (!raw) return SCANNER_DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SCANNER_DEFAULT_TIMEOUT_MS;
}

function outagePolicyFromEnv(): OutagePolicy {
  return Bun.env.KIMI_SECURITY_SCANNER_OUTAGE_POLICY === "ignore" ? "ignore" : "warn";
}

export const scanner: Bun.Security.Scanner = {
  version: "1",
  async scan({ packages }) {
    return scanPackages(packages, {
      fetchFn: fetchWithTimeout,
      timeoutMs: timeoutMsFromEnv(),
      outagePolicy: outagePolicyFromEnv(),
      onOutage: (message) => console.error(`[kimi-security-scanner] ${message}`),
    });
  },
};
