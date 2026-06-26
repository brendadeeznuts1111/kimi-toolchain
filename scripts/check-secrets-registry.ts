#!/usr/bin/env bun
/**
 * check-secrets-registry.ts — CI guard: verify secrets-policy.json5 ↔ secrets-constants.ts
 *
 * Checks:
 *   1. Every service in secrets-policy.json5 has a matching Services.* constant.
 *   2. Every secret name in the policy has a matching SecretKeys.* entry.
 *   3. Every consumer in the policy exists in the Consumers object.
 *   4. Every Services.* constant has at least one entry in the policy.
 *   5. Naming rules: services use reverse-domain format (or known legacy), consumers are kebab-case.
 *
 * Usage:
 *   bun scripts/check-secrets-registry.ts
 *   bun scripts/check-secrets-registry.ts --json
 *
 * Exit code: number of violations (0 = clean)
 */

import { Services, Consumers, SecretKeys } from "../src/lib/secrets-constants.ts";

const startNs = Bun.nanoseconds();
const JSON_MODE = process.argv.includes("--json");

// ─── Load policy ──────────────────────────────────────────────────────────────

const policyPath = new URL("../secrets-policy.json5", import.meta.url).pathname;
const policyFile = Bun.file(policyPath);
if (!(await policyFile.exists())) {
  console.error(`✗ secrets-policy.json5 not found at ${policyPath}`);
  process.exit(1);
}

type PolicyEntry = {
  allowedConsumers: string[];
  rotationDays: number;
  lastRotated: string | null;
  version: number;
};
type PolicyDoc = { $schema: string } & Record<string, Record<string, PolicyEntry>>;

const policyText = await policyFile.text();
const policy =
  ((Bun as unknown as { JSON5: { parse(s: string): unknown } }).JSON5?.parse(
    policyText
  ) as PolicyDoc) ?? (JSON.parse(policyText) as PolicyDoc);

// ─── Build derived sets ───────────────────────────────────────────────────────

const serviceValues = new Set<string>(Object.values(Services));
const consumerValues = new Set<string>(Object.values(Consumers));
const secretKeyEntries = Object.values(SecretKeys).map((k) => `${k.service}:${k.name}`);
const secretKeySet = new Set(secretKeyEntries);

// ─── Violations collector ─────────────────────────────────────────────────────

interface Violation {
  severity: "ERROR" | "WARN";
  check: string;
  detail: string;
}

const violations: Violation[] = [];

function error(check: string, detail: string) {
  violations.push({ severity: "ERROR", check, detail });
}
function warn(check: string, detail: string) {
  violations.push({ severity: "WARN", check, detail });
}

// ─── Check 1: Policy services have a Services.* constant ─────────────────────

const policyServices = Object.keys(policy).filter((k) => k !== "$schema");

for (const svc of policyServices) {
  if (!serviceValues.has(svc)) {
    error(
      "missing-service-constant",
      `Policy service "${svc}" has no matching Services.* constant in secrets-constants.ts`
    );
  }
}

// ─── Check 2: Every SecretKeys.* entry exists in policy ───────────────────────

for (const [constName, key] of Object.entries(SecretKeys)) {
  const svcEntry = policy[key.service];
  if (!svcEntry) {
    error(
      "missing-policy-service",
      `SecretKeys.${constName} references service "${key.service}" which is absent from policy`
    );
    continue;
  }
  if (!svcEntry[key.name]) {
    error(
      "missing-policy-secret",
      `SecretKeys.${constName} references "${key.service}/${key.name}" which is absent from policy`
    );
  }
}

// ─── Check 3: Every policy secret has a SecretKeys.* entry ───────────────────

for (const [svc, secrets] of Object.entries(policy)) {
  if (svc === "$schema") continue;
  for (const secretName of Object.keys(secrets)) {
    const key = `${svc}:${secretName}`;
    if (!secretKeySet.has(key)) {
      warn(
        "missing-secret-constant",
        `Policy secret "${svc}/${secretName}" has no SecretKeys.* entry in secrets-constants.ts`
      );
    }
  }
}

// ─── Check 4: Every policy consumer exists in Consumers.* ────────────────────

for (const [svc, secrets] of Object.entries(policy)) {
  if (svc === "$schema") continue;
  for (const [secretName, entry] of Object.entries(secrets)) {
    for (const consumer of entry.allowedConsumers) {
      if (!consumerValues.has(consumer)) {
        warn(
          "missing-consumer-constant",
          `Policy "${svc}/${secretName}" allows consumer "${consumer}" with no Consumers.* constant`
        );
      }
    }
  }
}

// ─── Check 5: Every Services.* constant has at least one policy entry ─────────

for (const [constName, svc] of Object.entries(Services)) {
  if (!policy[svc]) {
    warn(
      "orphan-service-constant",
      `Services.${constName} = "${svc}" has no entries in secrets-policy.json5`
    );
  }
}

// ─── Check 6: Naming convention ───────────────────────────────────────────────

const REVERSE_DOMAIN_RE = /^[a-z]+\.[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*/;
const LEGACY_SERVICES = new Set(["kimi-toolchain"]);
const KEBAB_RE = /^[a-z][a-z0-9:]*(-[a-z0-9:]+)*$/;

for (const svc of policyServices) {
  if (!LEGACY_SERVICES.has(svc) && !REVERSE_DOMAIN_RE.test(svc)) {
    warn(
      "naming-convention",
      `Service "${svc}" does not follow reverse-domain format (e.g. com.herdr.dashboard)`
    );
  }
  if (/\.(prod|dev|staging|test|v\d+)(\.|$)/.test(svc)) {
    error(
      "naming-convention",
      `Service "${svc}" contains forbidden suffix (environment or version). Use policy environments instead.`
    );
  }
}

for (const [svc, secrets] of Object.entries(policy)) {
  if (svc === "$schema") continue;
  for (const [secretName, entry] of Object.entries(secrets)) {
    for (const consumer of entry.allowedConsumers) {
      if (!KEBAB_RE.test(consumer)) {
        warn(
          "consumer-naming",
          `Consumer "${consumer}" in "${svc}/${secretName}" should be kebab-case`
        );
      }
    }
  }
}

// ─── Check 7: Init template sync ──────────────────────────────────────────────

const kimiSecretsPath = new URL("../src/bin/kimi-secrets.ts", import.meta.url).pathname;
const kimiSecretsSrc = await Bun.file(kimiSecretsPath).text();

// Extract the template block between the first `const template = \`{` and the closing `\`;`
const templateMatch = kimiSecretsSrc.match(/const template = `([\s\S]+?)`;/);
if (templateMatch) {
  const templateBody = templateMatch[1];
  if (!templateBody) {
    error("init-template", "Unable to read kimi-secrets init template body");
  } else {
    for (const [svc, secrets] of Object.entries(policy)) {
      if (svc === "$schema") continue;
      if (!templateBody.includes(`"${svc}"`)) {
        error("init-template", `Service "${svc}" missing from kimi-secrets init template`);
      }
      for (const secretName of Object.keys(secrets)) {
        if (!templateBody.includes(`"${secretName}"`)) {
          error(
            "init-template",
            `Secret "${svc}/${secretName}" missing from kimi-secrets init template`
          );
        }
      }
    }
  }
}

// ─── Output ───────────────────────────────────────────────────────────────────

const elapsedMs = ((Bun.nanoseconds() - startNs) / 1e6).toFixed(1);
const errors = violations.filter((v) => v.severity === "ERROR");
const warnings = violations.filter((v) => v.severity === "WARN");

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      { elapsedMs, errors: errors.length, warnings: warnings.length, violations },
      null,
      2
    )
  );
  process.exit(errors.length);
}

const C = {
  RED: (s: string) => (process.stdout.isTTY ? `\x1b[38;2;230;57;70m${s}\x1b[0m` : s),
  AMBER: (s: string) => (process.stdout.isTTY ? `\x1b[38;2;244;160;36m${s}\x1b[0m` : s),
  GREEN: (s: string) => (process.stdout.isTTY ? `\x1b[38;2;51;204;102m${s}\x1b[0m` : s),
  BOLD: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  DIM: (s: string) => (process.stdout.isTTY ? `\x1b[38;2;128;128;128m${s}\x1b[0m` : s),
};

console.log();
console.log(C.BOLD("=== Secrets Registry Check ==="));
console.log();

if (violations.length === 0) {
  console.log(C.GREEN(`✓ secrets-policy.json5 ↔ secrets-constants.ts in sync (${elapsedMs}ms)`));
  console.log(
    C.DIM(
      `  ${policyServices.length} services · ${secretKeyEntries.length} secret keys · ${Object.keys(Consumers).length} consumers`
    )
  );
} else {
  for (const v of violations) {
    const icon = v.severity === "ERROR" ? C.RED("✗ ERROR") : C.AMBER("⚠ WARN ");
    console.log(`  ${icon}  [${v.check}] ${v.detail}`);
  }
  console.log();
  const verdict =
    errors.length > 0
      ? C.RED(
          `✗ ${errors.length} error(s), ${warnings.length} warning(s) — fix before merging (${elapsedMs}ms)`
        )
      : C.AMBER(`⚠ 0 errors, ${warnings.length} warning(s) (${elapsedMs}ms)`);
  console.log(C.BOLD(verdict));
}
console.log();

process.exit(errors.length);
