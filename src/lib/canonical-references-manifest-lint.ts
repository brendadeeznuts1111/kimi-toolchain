/**
 * Bun-native structural validation for canonical reference manifests and TOML link tables.
 */

import type {
  EcosystemReference,
  EcosystemReferenceStatus,
  LocalDocReference,
  ReferenceKind,
  RepoFramework,
  RepoLanguage,
  RepoReference,
  RepoRole,
} from "./canonical-references.ts";
import { CANONICAL_REFERENCES_SCHEMA_VERSION } from "./canonical-references.ts";

const VALID_REFERENCE_KINDS = new Set<ReferenceKind>([
  "runtime",
  "library",
  "product",
  "platform",
  "docs",
  "repo",
  "mcp",
]);

const VALID_ECOSYSTEM_STATUSES = new Set<EcosystemReferenceStatus>([
  "active",
  "deprecated",
  "experimental",
  "external-fork",
]);

const VALID_REPO_ROLES = new Set<RepoRole>(["upstream", "tool", "dependency"]);
const VALID_REPO_LANGUAGES = new Set<RepoLanguage>(["typescript", "rust", "javascript"]);
const VALID_REPO_FRAMEWORKS = new Set<RepoFramework>(["bun", "node", "effect", "oxc"]);

const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CURSOR_CANVAS_PATTERN = /^docs\/canvases\/.*\.canvas\.tsx$/;
const CARD_INFLUENCE_PATTERN = /^card-[a-z0-9-]+$/;

export interface CanonicalReferencesLinkTables {
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}

function isValidId(value: string, violations: string[], path: string): boolean {
  if (!MANIFEST_ID_PATTERN.test(value)) {
    violations.push(`${path}: invalid id "${value}" — expected /^[a-z][a-z0-9-]{0,63}$/`);
    return false;
  }
  return true;
}

/** Local filesystem paths allowed in ecosystem homepage/docs/install fields. */
export function isLocalReferencePath(value: string): boolean {
  return value.startsWith("~/") || value.startsWith("./") || value.startsWith("/") || value === ".";
}

function isValidHttpUrl(value: string, violations: string[], path: string): boolean {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    violations.push(`${path}: invalid URL "${value}"`);
    return false;
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) {
      violations.push(`${path}: invalid URL "${value}" — missing host`);
      return false;
    }
    return true;
  } catch {
    violations.push(`${path}: invalid URL "${value}"`);
    return false;
  }
}

/** Ecosystem URL fields accept https URLs or local paths (~/ ./ /). */
function isValidEcosystemReferenceUrl(value: string, violations: string[], path: string): boolean {
  if (isLocalReferencePath(value)) return true;
  return isValidHttpUrl(value, violations, path);
}

function isValidSemver(value: string, violations: string[], path: string): boolean {
  try {
    Bun.semver.order(value, value);
    return true;
  } catch {
    violations.push(`${path}: invalid semver "${value}"`);
    return false;
  }
}

function isValidGithubRepoUrl(value: string, violations: string[], path: string): boolean {
  if (!isValidHttpUrl(value, violations, path)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      violations.push(`${path}: repo url must be https://github.com/...`);
      return false;
    }
    if (value.endsWith(".git")) {
      violations.push(`${path}: url must not end with .git`);
      return false;
    }
    if (value.endsWith("/")) {
      violations.push(`${path}: url must not end with /`);
      return false;
    }
    return true;
  } catch {
    violations.push(`${path}: invalid repo url "${value}"`);
    return false;
  }
}

function lintDuplicateIds<T extends { id: string }>(items: readonly T[], label: string): string[] {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `${label}: duplicate id "${id}" appears ${count} times`);
}

/** Bun-native structural validation for manifest link tables. */
export function lintCanonicalReferencesLinkTables(tables: CanonicalReferencesLinkTables): string[] {
  const violations: string[] = [];
  violations.push(...lintDuplicateIds(tables.ecosystem, "ecosystem"));
  violations.push(...lintDuplicateIds(tables.localDocs, "localDocs"));
  violations.push(...lintDuplicateIds(tables.repos, "repos"));

  const repoById = new Map<string, RepoReference>();
  const ecosystemById = new Map<string, EcosystemReference>();
  for (const repo of tables.repos) repoById.set(repo.id, repo);
  for (const ref of tables.ecosystem) ecosystemById.set(ref.id, ref);

  for (const ref of tables.ecosystem) {
    const path = `ecosystem.${ref.id}`;
    if (!ref.id || !isValidId(ref.id, violations, `${path}.id`)) continue;
    if (!ref.name) violations.push(`${path}.name: required`);
    if (!VALID_REFERENCE_KINDS.has(ref.kind)) {
      violations.push(`${path}.kind: invalid kind "${ref.kind}"`);
    }
    if (!isValidEcosystemReferenceUrl(ref.homepage, violations, `${path}.homepage`)) continue;
    if (!isValidEcosystemReferenceUrl(ref.docs, violations, `${path}.docs`)) continue;
    if (!ref.usage) violations.push(`${path}.usage: required`);
    if (
      ref.minVersion !== undefined &&
      !isValidSemver(ref.minVersion, violations, `${path}.minVersion`)
    ) {
      continue;
    }
    if (
      ref.install !== undefined &&
      !isValidEcosystemReferenceUrl(ref.install, violations, `${path}.install`)
    ) {
      continue;
    }
    if (ref.repoId !== undefined) {
      if (!isValidId(ref.repoId, violations, `${path}.repoId`)) continue;
      if (!ref.noRepo && !repoById.has(ref.repoId)) {
        violations.push(`${path}.repoId: references unknown repo "${ref.repoId}"`);
      }
    }
    if (ref.noRepo !== undefined && ref.noRepo !== true) {
      violations.push(`${path}.noRepo: must be true or absent`);
    }
    if (ref.status !== undefined && !VALID_ECOSYSTEM_STATUSES.has(ref.status)) {
      violations.push(`${path}.status: invalid status "${ref.status}"`);
    }
  }

  for (const doc of tables.localDocs) {
    const path = `localDocs.${doc.id}`;
    if (!doc.id || !isValidId(doc.id, violations, `${path}.id`)) continue;
    if (!doc.repoPath) violations.push(`${path}.repoPath: required`);
    if (!doc.runtimePath || !doc.runtimePath.startsWith("~/")) {
      violations.push(`${path}.runtimePath: must start with "~/"`);
    }
    if (!doc.purpose) violations.push(`${path}.purpose: required`);
    if (doc.cursorCanvas !== undefined && !CURSOR_CANVAS_PATTERN.test(doc.cursorCanvas)) {
      violations.push(`${path}.cursorCanvas: must match "docs/canvases/*.canvas.tsx"`);
    }
    if (doc.canvasId !== undefined && !isValidId(doc.canvasId, violations, `${path}.canvasId`)) {
      continue;
    }
    if (
      doc.canvasVersion !== undefined &&
      !isValidSemver(doc.canvasVersion, violations, `${path}.canvasVersion`)
    ) {
      continue;
    }
    if (
      doc.canvasReadOrder !== undefined &&
      (!Number.isInteger(doc.canvasReadOrder) || doc.canvasReadOrder < 0)
    ) {
      violations.push(`${path}.canvasReadOrder: must be a non-negative integer`);
    }
    if (doc.canvasInfluences !== undefined) {
      for (const cardId of doc.canvasInfluences) {
        if (!CARD_INFLUENCE_PATTERN.test(cardId)) {
          violations.push(`${path}.canvasInfluences: invalid card id "${cardId}"`);
        }
      }
    }
  }

  for (const repo of tables.repos) {
    const path = `repos.${repo.id}`;
    if (!repo.id || !isValidId(repo.id, violations, `${path}.id`)) continue;
    if (!repo.name) violations.push(`${path}.name: required`);
    if (!isValidGithubRepoUrl(repo.url, violations, `${path}.url`)) continue;
    if (
      repo.ciStatusUrl !== undefined &&
      !isValidHttpUrl(repo.ciStatusUrl, violations, `${path}.ciStatusUrl`)
    ) {
      continue;
    }
    if (repo.clonePath !== undefined && !repo.clonePath.startsWith("~/")) {
      violations.push(`${path}.clonePath: must start with "~/"`);
    }
    if (repo.role !== undefined && !VALID_REPO_ROLES.has(repo.role)) {
      violations.push(`${path}.role: invalid role "${repo.role}"`);
    }
    if (repo.language !== undefined && !VALID_REPO_LANGUAGES.has(repo.language)) {
      violations.push(`${path}.language: invalid language "${repo.language}"`);
    }
    if (repo.frameworks !== undefined) {
      for (const framework of repo.frameworks) {
        if (!VALID_REPO_FRAMEWORKS.has(framework)) {
          violations.push(`${path}.frameworks: invalid framework "${framework}"`);
        }
      }
    }
    if (repo.provides !== undefined) {
      for (const ecosystemId of repo.provides) {
        if (!ecosystemById.has(ecosystemId)) {
          violations.push(`${path}.provides: references unknown ecosystem "${ecosystemId}"`);
        }
      }
    }
  }

  return violations;
}

/** Bun-native manifest validation — metadata plus link tables. */
export interface LintManifestBunNativeInput {
  schemaVersion: number;
  generatedAt?: string;
  toolchainVersion?: string;
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}

export function lintManifestBunNative(manifest: LintManifestBunNativeInput): string[] {
  const violations: string[] = [];

  if (manifest.schemaVersion !== CANONICAL_REFERENCES_SCHEMA_VERSION) {
    violations.push(
      `schemaVersion: expected ${CANONICAL_REFERENCES_SCHEMA_VERSION}, got ${manifest.schemaVersion}`
    );
  }
  if ("generatedAt" in manifest && manifest.generatedAt !== undefined) {
    if (
      typeof manifest.generatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(manifest.generatedAt)
    ) {
      violations.push(
        `generatedAt: expected ISO 8601 string, got ${JSON.stringify(manifest.generatedAt)}`
      );
    }
  }
  if ("toolchainVersion" in manifest && manifest.toolchainVersion !== undefined) {
    if (typeof manifest.toolchainVersion !== "string" || manifest.toolchainVersion.length === 0) {
      violations.push("toolchainVersion: expected non-empty string");
    }
  }

  violations.push(
    ...lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    })
  );

  return violations;
}
