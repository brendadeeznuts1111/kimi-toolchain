/**
 * Secrets registry lint — SecretKeys ↔ policy ↔ docs parity.
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";
import {
  Consumers,
  SECRETS_POLICY_FILE,
  SECRETS_REGISTRY_DOC,
  SecretKeys,
  Services,
} from "./secrets-constants.ts";
import { loadSecretsPolicy, validateSecretsPolicy } from "./secrets-policy.ts";
import { allowsEnvFallback } from "./secrets-storage.ts";

export interface SecretsRegistryLintIssue {
  severity: "error" | "warn";
  message: string;
}

const SERVICE_DOC_RE = /^\|\s*`Services\.([A-Z_]+)`\s*\|\s*`([^`]+)`\s*\|/;

function policyKey(service: string, name: string): string {
  return `${service}/${name}`;
}

function parseDocServiceIds(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(SERVICE_DOC_RE);
    if (match) map.set(match[1]!, match[2]!);
  }
  return map;
}

export async function lintSecretsRegistry(repoRoot: string): Promise<SecretsRegistryLintIssue[]> {
  const issues: SecretsRegistryLintIssue[] = [];
  const policyPath = join(repoRoot, SECRETS_POLICY_FILE);
  const registryPath = join(repoRoot, SECRETS_REGISTRY_DOC);

  if (!pathExists(registryPath)) {
    issues.push({ severity: "error", message: `missing registry doc: ${SECRETS_REGISTRY_DOC}` });
  }

  if (!pathExists(policyPath)) {
    issues.push({ severity: "error", message: `missing policy file: ${SECRETS_POLICY_FILE}` });
    return issues;
  }

  const policy = await loadSecretsPolicy(policyPath);
  const validation = validateSecretsPolicy(policy);
  if (!validation.ok) {
    for (const err of validation.errors) {
      issues.push({ severity: "error", message: `policy: ${err}` });
    }
    return issues;
  }

  const consumerValues = new Set(Object.values(Consumers));
  const registeredKeys = new Set<string>();
  const policyKeys = new Set<string>();

  for (const [service, serviceEntry] of Object.entries(policy)) {
    if (service === "$schema" || typeof serviceEntry !== "object" || serviceEntry === null)
      continue;
    for (const [name, entry] of Object.entries(serviceEntry)) {
      policyKeys.add(policyKey(service, name));
      for (const consumer of entry.allowedConsumers) {
        if (!consumerValues.has(consumer as (typeof Consumers)[keyof typeof Consumers])) {
          issues.push({
            severity: "error",
            message: `policy ${service}/${name}: unknown consumer "${consumer}" — add to Consumers in secrets-constants.ts`,
          });
        }
      }
      if (service === Services.CI && !allowsEnvFallback(entry)) {
        issues.push({
          severity: "error",
          message: `policy ${service}/${name}: CI service secrets require storageTier: "env-fallback"`,
        });
      }
    }
  }

  for (const key of Object.values(SecretKeys)) {
    const id = policyKey(key.service, key.name);
    registeredKeys.add(id);
    if (!policyKeys.has(id)) {
      issues.push({
        severity: "error",
        message: `SecretKeys missing policy entry: ${id}`,
      });
    }
  }

  for (const id of policyKeys) {
    if (!registeredKeys.has(id)) {
      issues.push({
        severity: "warn",
        message: `policy orphan (no SecretKeys constant): ${id}`,
      });
    }
  }

  if (pathExists(registryPath)) {
    const docServices = parseDocServiceIds(readText(registryPath));
    for (const [constName, serviceId] of Object.entries(Services)) {
      const docId = docServices.get(constName);
      if (!docId) {
        issues.push({
          severity: "error",
          message: `registry doc missing Services.${constName} row in ${SECRETS_REGISTRY_DOC}`,
        });
      } else if (docId !== serviceId) {
        issues.push({
          severity: "error",
          message: `registry doc Services.${constName}: expected \`${serviceId}\`, got \`${docId}\``,
        });
      }
    }
    for (const constName of docServices.keys()) {
      if (!(constName in Services)) {
        issues.push({
          severity: "error",
          message: `registry doc orphan Services.${constName} — remove or add to secrets-constants.ts`,
        });
      }
    }
  }

  return issues;
}
