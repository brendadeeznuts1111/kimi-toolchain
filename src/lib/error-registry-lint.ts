/**
 * Error domain registry lint — constants ↔ docs parity.
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";
import {
  ERROR_DOMAIN_DEFINITIONS,
  ERROR_DOMAIN_IDS,
  ERROR_REGISTRY_DOC,
  type ErrorDomainId,
} from "./error-domains-constants.ts";

export interface ErrorRegistryLintIssue {
  severity: "error" | "warn";
  message: string;
}

const REGISTRY_ID_RE = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|/;

function parseRegistryIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(REGISTRY_ID_RE);
    if (match) ids.add(match[1]!);
  }
  return ids;
}

export function lintErrorRegistry(repoRoot: string): ErrorRegistryLintIssue[] {
  const issues: ErrorRegistryLintIssue[] = [];
  const registryPath = join(repoRoot, ERROR_REGISTRY_DOC);

  if (!pathExists(registryPath)) {
    issues.push({
      severity: "error",
      message: `missing registry doc: ${ERROR_REGISTRY_DOC}`,
    });
    return issues;
  }

  const registryIds = parseRegistryIds(readText(registryPath));
  const constantIds = new Set<ErrorDomainId>(ERROR_DOMAIN_IDS);

  for (const id of constantIds) {
    if (!registryIds.has(id)) {
      issues.push({
        severity: "error",
        message: `registry missing domain id \`${id}\` — add row to ${ERROR_REGISTRY_DOC}`,
      });
    }
  }

  for (const id of registryIds) {
    if (!constantIds.has(id as ErrorDomainId)) {
      issues.push({
        severity: "error",
        message: `registry orphan id \`${id}\` — remove row or add to error-domains-constants.ts`,
      });
    }
  }

  const domains = ERROR_DOMAIN_DEFINITIONS.map((d) => d.domain);
  if (new Set(domains).size !== domains.length) {
    issues.push({
      severity: "error",
      message: "duplicate reverse-domain strings in ERROR_DOMAIN_DEFINITIONS",
    });
  }

  for (const def of ERROR_DOMAIN_DEFINITIONS) {
    if (!def.domain.includes(".")) {
      issues.push({
        severity: "error",
        message: `domain \`${def.id}\` must use reverse-domain notation (got ${def.domain})`,
      });
    }
  }

  return issues;
}
