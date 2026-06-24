/**
 * Canonical ecosystem and documentation links — types, validators, and consumers.
 * SSOT: canonical-references.toml → canonical-references-data.ts + canonical-references.json.
 */

import { join } from "path";
import { pathExists, readJsonFile, readText } from "./bun-io.ts";
import { canonicalReferencesPath, homeDir } from "./paths.ts";
import { readPackageManifest, safeParse } from "./utils.ts";
import { TOOLCHAIN_VERSION } from "./version.ts";
import { stableStringify } from "./build-constants-registry.ts";
import {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  type CanonicalReferencesManifest,
  type EcosystemReference,
  type EcosystemReferenceStatus,
  type LocalDocReference,
  type ReferenceKind,
  type RepoFramework,
  type RepoLanguage,
  type RepoReference,
  type RepoRole,
} from "./canonical-references-types.ts";

export {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  type CanonicalReferencesManifest,
  type EcosystemReference,
  type EcosystemReferenceStatus,
  type LocalDocReference,
  type ReferenceKind,
  type RepoFramework,
  type RepoLanguage,
  type RepoReference,
  type RepoRole,
};
export const CANONICAL_REFERENCES_FILENAME = "canonical-references.json";
/** Prefix for every `LocalDocReference.runtimePath` synced to ~/.kimi-code/. */
export const KIMI_CODE_RUNTIME_PREFIX = "~/.kimi-code/" as const;

const ECOSYSTEM_STATUS_ICONS: Record<EcosystemReferenceStatus, string> = {
  active: "✅",
  deprecated: "⚠️",
  experimental: "🧪",
  "external-fork": "🍴",
};

/** Resolve omitted ecosystem status to `active`. */
export function resolveEcosystemReferenceStatus(
  status?: EcosystemReferenceStatus
): EcosystemReferenceStatus {
  return status ?? "active";
}

/** Display label for inspect tables — Unicode icon + status slug (manifest JSON keeps bare enum). */
export function formatEcosystemReferenceStatus(status?: EcosystemReferenceStatus): string {
  const resolved = resolveEcosystemReferenceStatus(status);
  return `${ECOSYSTEM_STATUS_ICONS[resolved]} ${resolved}`;
}

export interface EcosystemReferenceInspectRow {
  id: string;
  kind: ReferenceKind;
  package: string;
  minVersion: string;
  status: string;
  repoId: string;
  sourceRepo: string;
}

/** Shared row shape for `references:inspect` ecosystem tables. */
export function ecosystemReferenceInspectRow(
  ref: EcosystemReference,
  repoNameById: ReadonlyMap<string, string>
): EcosystemReferenceInspectRow {
  const resolvedRepoId = ref.repoId ?? `${ref.id}-upstream`;
  const repoName = repoNameById.get(resolvedRepoId);
  return {
    id: ref.id,
    kind: ref.kind,
    package: ref.package ?? "—",
    minVersion: ref.minVersion ?? "—",
    status: formatEcosystemReferenceStatus(ref.status),
    repoId: ref.noRepo ? "(noRepo)" : resolvedRepoId,
    sourceRepo: ref.noRepo ? "—" : (repoName ?? "?"),
  };
}

/** Link tables — generated from canonical-references.toml; run `bun run references:generate`. */
import {
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
} from "./canonical-references-data.ts";
export { ECOSYSTEM_REFERENCES, LOCAL_DOC_REFERENCES, REPO_REFERENCES };

import {
  lintCanonicalReferencesLinkTables,
  lintManifestBunNative,
  type CanonicalReferencesLinkTables,
} from "./canonical-references-manifest-lint.ts";
export { lintCanonicalReferencesLinkTables, lintManifestBunNative };
export type { CanonicalReferencesLinkTables };
/** Repo-root manifest path (not the synced runtime copy — use paths.canonicalReferencesPath). */
export function repoCanonicalReferencesPath(projectRoot: string): string {
  return join(projectRoot, CANONICAL_REFERENCES_FILENAME);
}

export function buildCanonicalReferencesManifestFromTables(
  tables: CanonicalReferencesLinkTables
): CanonicalReferencesManifest {
  return {
    schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    toolchainVersion: TOOLCHAIN_VERSION,
    ecosystem: [...tables.ecosystem],
    localDocs: [...tables.localDocs],
    repos: [...tables.repos],
  };
}

export function buildCanonicalReferencesManifest(): CanonicalReferencesManifest {
  return buildCanonicalReferencesManifestFromTables({
    ecosystem: [...ECOSYSTEM_REFERENCES],
    localDocs: [...LOCAL_DOC_REFERENCES],
    repos: [...REPO_REFERENCES],
  });
}

export function isCanonicalReferencesManifest(val: unknown): val is CanonicalReferencesManifest {
  if (typeof val !== "object" || val === null) return false;
  const v = val as CanonicalReferencesManifest;
  return (
    v.schemaVersion === CANONICAL_REFERENCES_SCHEMA_VERSION &&
    typeof v.generatedAt === "string" &&
    typeof v.toolchainVersion === "string" &&
    Array.isArray(v.ecosystem) &&
    Array.isArray(v.localDocs) &&
    Array.isArray(v.repos)
  );
}

export async function readCanonicalReferencesFile(
  filePath: string
): Promise<CanonicalReferencesManifest | null> {
  if (!pathExists(filePath)) return null;
  try {
    const parsed = await readJsonFile(filePath);
    return isCanonicalReferencesManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readCanonicalReferencesManifest(
  projectRoot: string
): Promise<CanonicalReferencesManifest | null> {
  return readCanonicalReferencesFile(repoCanonicalReferencesPath(projectRoot));
}

export interface CanonicalReferencesHealthCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface CanonicalReferencesHealthReport {
  applicable: boolean;
  aligned: boolean;
  checks: CanonicalReferencesHealthCheck[];
  fixPlan: string[];
  repoManifest: CanonicalReferencesManifest | null;
  runtimeManifest: CanonicalReferencesManifest | null;
  runtimeSynced: boolean;
}

/** Probe IDs for herdr orchestrator handoff rules (`probe:<id>`). */
export const CANONICAL_REFERENCES_PROBE_IDS = [
  "canonical-references:repo-fresh",
  "canonical-references:runtime-aligned",
  "canonical-references:runtime-cache",
] as const;

export type CanonicalReferencesProbeId = (typeof CANONICAL_REFERENCES_PROBE_IDS)[number];

export function isCanonicalReferencesProbeId(id: string): id is CanonicalReferencesProbeId {
  return (CANONICAL_REFERENCES_PROBE_IDS as readonly string[]).includes(id);
}

type CanonicalReferencesProbeSuffix = "repo-fresh" | "runtime-aligned" | "runtime-cache";

/** Map probe suffixes to health checks, including prerequisite fallbacks. */
export function resolveProbeHealthCheck(
  suffix: CanonicalReferencesProbeSuffix,
  checks: CanonicalReferencesHealthCheck[]
): CanonicalReferencesHealthCheck | null {
  const byName = (name: string) => checks.find((entry) => entry.name === name);

  if (suffix === "runtime-cache") {
    const cache = byName("runtime-cache");
    if (cache) return cache;
    if (byName("runtime-aligned")) {
      return {
        name: "runtime-cache",
        status: "ok",
        message: "runtime cache present at ~/.kimi-code/",
        fixable: false,
      };
    }
    return byName("repo-manifest") ?? byName("repo-fresh") ?? null;
  }

  if (suffix === "repo-fresh") {
    return byName("repo-fresh") ?? byName("repo-manifest") ?? null;
  }

  return (
    byName("runtime-aligned") ??
    byName("runtime-cache") ??
    byName("repo-fresh") ??
    byName("repo-manifest") ??
    null
  );
}

/** Evaluate a `probe:canonical-references:*` handoff condition. */
export async function evaluateProbeHandoffCondition(
  probeId: string,
  projectRoot: string,
  home?: string
): Promise<{ ok: boolean; message: string }> {
  if (!isCanonicalReferencesProbeId(probeId)) {
    return { ok: false, message: `unknown probe condition: ${probeId}` };
  }
  const report = await auditCanonicalReferencesHealth(projectRoot, home);
  if (!report.applicable) {
    return { ok: false, message: "canonical references health not applicable for this project" };
  }
  const suffix = probeId.slice("canonical-references:".length) as CanonicalReferencesProbeSuffix;
  const check = resolveProbeHealthCheck(suffix, report.checks);
  if (!check) {
    return { ok: false, message: `probe check missing: ${probeId}` };
  }
  return {
    ok: check.status === "ok",
    message:
      check.status === "ok"
        ? check.message
        : `${check.message} — ${report.fixPlan[0] ?? "fix required"}`,
  };
}

/** Verify repo manifest freshness and ~/.kimi-code/ cached copy alignment. */
export async function auditCanonicalReferencesHealth(
  projectRoot: string,
  home?: string
): Promise<CanonicalReferencesHealthReport> {
  const checks: CanonicalReferencesHealthCheck[] = [];
  const fixPlan: string[] = [];
  const repoPath = repoCanonicalReferencesPath(projectRoot);
  const runtimePath = canonicalReferencesPath(home);

  if (!pathExists(repoPath)) {
    return {
      applicable:
        pathExists(join(projectRoot, "canonical-references.toml")) ||
        pathExists(join(projectRoot, "src/lib/canonical-references.ts")),
      aligned: false,
      checks: [
        {
          name: "repo-manifest",
          status: "error",
          message: `${CANONICAL_REFERENCES_FILENAME} missing — run bun run references:generate`,
          fixable: true,
        },
      ],
      fixPlan: ["bun run references:generate"],
      repoManifest: null,
      runtimeManifest: null,
      runtimeSynced: false,
    };
  }

  const generated = buildCanonicalReferencesManifest();
  const repoManifest = await readCanonicalReferencesFile(repoPath);
  if (!repoManifest) {
    checks.push({
      name: "repo-manifest",
      status: "error",
      message: `${CANONICAL_REFERENCES_FILENAME} invalid JSON or schema`,
      fixable: true,
    });
    fixPlan.push("bun run references:generate");
  } else if (manifestNeedsRefresh(generated, repoManifest)) {
    checks.push({
      name: "repo-fresh",
      status: "error",
      message: "repo manifest stale vs canonical-references.toml (generated tables)",
      fixable: true,
    });
    fixPlan.push("bun run references:generate");
  } else {
    checks.push({
      name: "repo-fresh",
      status: "ok",
      message: "repo manifest matches source tables",
      fixable: false,
    });
  }

  const runtimeManifest = await readCanonicalReferencesFile(runtimePath);
  if (!runtimeManifest) {
    checks.push({
      name: "runtime-cache",
      status: "error",
      message: "runtime cache missing at ~/.kimi-code/",
      fixable: true,
    });
    fixPlan.push("bun run sync");
  } else if (repoManifest && !referencesContentEqual(repoManifest, runtimeManifest)) {
    checks.push({
      name: "runtime-aligned",
      status: "error",
      message: "runtime cache drifted from repo manifest",
      fixable: true,
    });
    fixPlan.push("bun run sync");
  } else if (repoManifest) {
    checks.push({
      name: "runtime-aligned",
      status: "ok",
      message: "runtime cache matches repo manifest",
      fixable: false,
    });
  }

  const pkgPath = join(projectRoot, "package.json");
  if (pathExists(pkgPath)) {
    try {
      const pkg = await readPackageManifest(projectRoot);
      const kimi = pkg?.kimi;
      const pointer =
        kimi && typeof kimi === "object" && !Array.isArray(kimi)
          ? (kimi as { canonicalReferences?: string }).canonicalReferences
          : undefined;
      if (pointer === CANONICAL_REFERENCES_FILENAME) {
        checks.push({
          name: "package-pointer",
          status: "ok",
          message: `package.json → kimi.canonicalReferences`,
          fixable: false,
        });
      } else {
        checks.push({
          name: "package-pointer",
          status: "warn",
          message: "package.json kimi.canonicalReferences missing or mispointed",
          fixable: true,
        });
      }
    } catch {
      // skip package parse errors
    }
  }

  const aligned = checks.every((check) => check.status === "ok");
  return {
    applicable: true,
    aligned,
    checks,
    fixPlan: [...new Set(fixPlan)],
    repoManifest,
    runtimeManifest,
    runtimeSynced: Boolean(
      repoManifest && runtimeManifest && referencesContentEqual(repoManifest, runtimeManifest)
    ),
  };
}

/** Compare link tables only — ignore generatedAt/toolchainVersion timestamps. */
export function referencesContentEqual(
  a: CanonicalReferencesManifest,
  b: CanonicalReferencesManifest
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    stableStringify(a.ecosystem) === stableStringify(b.ecosystem) &&
    stableStringify(a.localDocs) === stableStringify(b.localDocs) &&
    stableStringify(a.repos) === stableStringify(b.repos)
  );
}

/** Preserve generatedAt when link tables are unchanged — avoids timestamp-only git drift on sync. */
export function finalizeCanonicalReferencesManifest(
  generated: CanonicalReferencesManifest,
  existing: CanonicalReferencesManifest | null
): CanonicalReferencesManifest {
  if (existing && referencesContentEqual(generated, existing)) {
    return { ...generated, generatedAt: existing.generatedAt };
  }
  return generated;
}

export function manifestNeedsRefresh(
  generated: CanonicalReferencesManifest,
  existing: CanonicalReferencesManifest | null
): boolean {
  if (!existing) return true;
  return !referencesContentEqual(generated, existing);
}

export type EcosystemId = (typeof ECOSYSTEM_REFERENCES)[number]["id"];
export type RepoId = (typeof REPO_REFERENCES)[number]["id"];
export type LocalDocId = (typeof LOCAL_DOC_REFERENCES)[number]["id"];

function buildRepoById(): Record<RepoId, RepoReference> {
  const map = {} as Record<RepoId, RepoReference>;
  for (const repo of REPO_REFERENCES) {
    map[repo.id as RepoId] = repo;
  }
  return map;
}

/** O(1) typed lookup — prefer over scanning REPO_REFERENCES. */
export const REPO_BY_ID: Record<RepoId, RepoReference> = buildRepoById();

function buildEcosystemById(): Record<EcosystemId, EcosystemReference> {
  const map = {} as Record<EcosystemId, EcosystemReference>;
  for (const eco of ECOSYSTEM_REFERENCES) map[eco.id as EcosystemId] = eco;
  return map;
}

function buildLocalDocById(): Record<LocalDocId, LocalDocReference> {
  const map = {} as Record<LocalDocId, LocalDocReference>;
  for (const doc of LOCAL_DOC_REFERENCES) map[doc.id as LocalDocId] = doc;
  return map;
}

/** O(1) typed lookup — prefer over scanning ECOSYSTEM_REFERENCES. */
export const ECOSYSTEM_BY_ID: Record<EcosystemId, EcosystemReference> = buildEcosystemById();

/** O(1) typed lookup — prefer over scanning LOCAL_DOC_REFERENCES. */
export const LOCAL_DOC_BY_ID: Record<LocalDocId, LocalDocReference> = buildLocalDocById();

/** Normalize GitHub URLs for reverse lookup (strip .git, trailing slash, lowercase host/path). */
export function normalizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "").replace(/\.git$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url
      .trim()
      .toLowerCase()
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
  }
}

function buildRepoByUrl(): ReadonlyMap<string, RepoReference> {
  const map = new Map<string, RepoReference>();
  for (const repo of REPO_REFERENCES) {
    map.set(normalizeRepoUrl(repo.url), repo);
  }
  return map;
}

const REPO_BY_URL = buildRepoByUrl();

export function expandClonePath(clonePath: string): string {
  if (clonePath.startsWith("~/")) return join(homeDir(), clonePath.slice(2));
  if (clonePath === "~") return homeDir();
  return clonePath;
}

export function getEcosystem(id: EcosystemId): EcosystemReference {
  return ECOSYSTEM_BY_ID[id];
}

export function getRepo(id: RepoId): RepoReference {
  return REPO_BY_ID[id];
}

/** Resolve a repository from a GitHub URL (or normalized equivalent). */
export function getRepoByUrl(url: string): RepoReference | undefined {
  return REPO_BY_URL.get(normalizeRepoUrl(url));
}

/** Resolve a repository id from a GitHub URL — convenience over getRepoByUrl(). */
export function getRepoIdByUrl(url: string): RepoId | undefined {
  return getRepoByUrl(url)?.id;
}

/**
 * Resolve the REPO_REFERENCES entry for an ecosystem entry.
 * Uses explicit `repoId` when set; falls back to `<ecosystemId>-upstream` convention.
 */
export function resolveRepoForEcosystem(ref: EcosystemReference): RepoReference | undefined {
  if (ref.noRepo) return undefined;
  const repoId = ref.repoId ?? `${ref.id}-upstream`;
  return REPO_BY_ID[repoId as RepoId];
}

const GITHUB_URL_PATTERN = new URLPattern({
  protocol: "https",
  hostname: "github.com",
  pathname: "/:org/:repo{.git}?",
});

export type CanonicalReferencesInspectSection = "all" | "ecosystem" | "repos" | "docs";

export type EcosystemReferenceUrlField = "homepage" | "docs";

export type EcosystemReferenceUrlStatus = "ok" | "fail" | "skipped";

export interface EcosystemReferenceUrlIssue {
  ecosystemId: string;
  field: EcosystemReferenceUrlField;
  url: string;
  status: EcosystemReferenceUrlStatus;
  message: string;
}

export const ECOSYSTEM_REFERENCE_ONLINE_TIMEOUT_MS = 10_000;
export const ECOSYSTEM_REFERENCE_ONLINE_DELAY_MS = 200;

export function isHttpReferenceUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Collect ecosystem homepage/docs URLs eligible for online HEAD checks. */
export function collectEcosystemHttpUrls(): Array<{
  ecosystemId: string;
  field: EcosystemReferenceUrlField;
  url: string;
}> {
  const entries: Array<{
    ecosystemId: string;
    field: EcosystemReferenceUrlField;
    url: string;
  }> = [];
  for (const ref of ECOSYSTEM_REFERENCES) {
    if (isHttpReferenceUrl(ref.homepage)) {
      entries.push({ ecosystemId: ref.id, field: "homepage", url: ref.homepage });
    }
    if (isHttpReferenceUrl(ref.docs)) {
      entries.push({ ecosystemId: ref.id, field: "docs", url: ref.docs });
    }
  }
  return entries;
}

type ReferenceFetchFn = typeof fetch;

export async function checkEcosystemReferenceUrl(
  url: string,
  options: { fetchFn?: ReferenceFetchFn; timeoutMs?: number } = {}
): Promise<"ok" | "fail"> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? ECOSYSTEM_REFERENCE_ONLINE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetchFn(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
      return getRes.ok ? "ok" : "fail";
    }
    return res.ok ? "ok" : "fail";
  } catch {
    return "fail";
  } finally {
    clearTimeout(timer);
  }
}

export interface AuditEcosystemReferenceUrlsOnlineOptions {
  fetchFn?: ReferenceFetchFn;
  timeoutMs?: number;
  /** Politeness delay between checks; set 0 in tests. */
  delayMs?: number;
}

/** HEAD-check ecosystem homepage/docs URLs; skips non-http paths (e.g. dx local docs). */
export async function auditEcosystemReferenceUrlsOnline(
  options: AuditEcosystemReferenceUrlsOnlineOptions = {}
): Promise<EcosystemReferenceUrlIssue[]> {
  const {
    fetchFn = fetch,
    timeoutMs = ECOSYSTEM_REFERENCE_ONLINE_TIMEOUT_MS,
    delayMs = ECOSYSTEM_REFERENCE_ONLINE_DELAY_MS,
  } = options;

  const issues: EcosystemReferenceUrlIssue[] = [];

  for (const ref of ECOSYSTEM_REFERENCES) {
    for (const field of ["homepage", "docs"] as const) {
      const url = ref[field];
      if (!isHttpReferenceUrl(url)) {
        issues.push({
          ecosystemId: ref.id,
          field,
          url,
          status: "skipped",
          message: "non-http URL — skipped",
        });
        continue;
      }

      // MCP homepages are often authenticated RPC endpoints — not public HEAD targets.
      if (ref.kind === "mcp" && field === "homepage") {
        issues.push({
          ecosystemId: ref.id,
          field,
          url,
          status: "skipped",
          message: "mcp RPC endpoint — skipped",
        });
        continue;
      }

      const status = await checkEcosystemReferenceUrl(url, { fetchFn, timeoutMs });
      issues.push({
        ecosystemId: ref.id,
        field,
        url,
        status,
        message: status === "ok" ? "reachable" : "HEAD/GET check failed",
      });

      if (delayMs > 0) await Bun.sleep(delayMs);
    }
  }

  return issues;
}

export function formatEcosystemReferenceUrlReport(issues: EcosystemReferenceUrlIssue[]): string {
  const failures = issues.filter((i) => i.status === "fail");
  const skipped = issues.filter((i) => i.status === "skipped");
  if (failures.length === 0) {
    const checked = issues.length - skipped.length;
    return `references-online: ok (${checked} checked, ${skipped.length} skipped)`;
  }
  const lines = [`references-online: ${failures.length} failure(s)`];
  for (const issue of failures) {
    lines.push(`  ${issue.ecosystemId}.${issue.field} ${issue.url} — ${issue.message}`);
  }
  return lines.join("\n");
}

/** Validate that every REPO_REFERENCES url follows the canonical https://github.com/:org/:repo shape. */
export function lintRepoUrls(): string[] {
  const violations: string[] = [];
  for (const repo of REPO_REFERENCES) {
    if (!GITHUB_URL_PATTERN.test(repo.url)) {
      violations.push(
        `repo "${repo.id}": url "${repo.url}" does not match expected pattern https://github.com/:org/:repo`
      );
    } else if (repo.url.endsWith(".git")) {
      violations.push(
        `repo "${repo.id}": url "${repo.url}" has trailing .git — use bare HTTPS URL`
      );
    } else if (repo.url.endsWith("/")) {
      violations.push(`repo "${repo.id}": url "${repo.url}" has trailing slash — remove it`);
    }
  }
  return violations;
}

/** Lint duplicate repo ids and normalized URLs. */
export function lintRepoDuplicateKeys(): string[] {
  const violations: string[] = [];
  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, string>();

  for (const repo of REPO_REFERENCES) {
    seenIds.set(repo.id, (seenIds.get(repo.id) ?? 0) + 1);
    const normalized = normalizeRepoUrl(repo.url);
    const prior = seenUrls.get(normalized);
    if (prior) {
      violations.push(`repo duplicate url: "${repo.id}" and "${prior}" both map to ${normalized}`);
    } else {
      seenUrls.set(normalized, repo.id);
    }
  }

  for (const [id, count] of seenIds) {
    if (count > 1) violations.push(`repo duplicate id: "${id}" appears ${count} times`);
  }

  return violations;
}

/** Lint repo.provides ↔ ecosystem.repoId bidirectional links. */
export function lintRepoProvidesLinks(): string[] {
  const violations: string[] = [];

  for (const repo of REPO_REFERENCES) {
    for (const ecoId of repo.provides ?? []) {
      const eco = ecosystemReferenceById(ecoId);
      if (!eco) {
        violations.push(`repo "${repo.id}": provides unknown ecosystem id "${ecoId}"`);
        continue;
      }
      const linked = resolveRepoForEcosystem(eco);
      if (!linked || linked.id !== repo.id) {
        violations.push(
          `repo "${repo.id}": provides "${ecoId}" but ecosystem links to "${linked?.id ?? "none"}"`
        );
      }
    }
  }

  return violations;
}

export interface LintRepoClonePathsOptions {
  /** Accept this directory as a valid clone root for kimi-toolchain (worktree-safe). */
  projectRoot?: string;
  /** Skip filesystem checks (unit tests / sandboxes without canonical clone). */
  skipFilesystem?: boolean;
}

/** Validate clonePath exists and package.json name matches expectedPackageName. */
export function lintRepoClonePaths(options: LintRepoClonePathsOptions = {}): string[] {
  if (options.skipFilesystem) return [];

  const violations: string[] = [];
  const projectRoot = options.projectRoot ?? process.cwd();

  for (const repo of REPO_REFERENCES) {
    if (!repo.clonePath) continue;

    const absolute = expandClonePath(repo.clonePath);
    const expectedName = repo.expectedPackageName ?? repo.name;
    const candidateRoots = new Set([absolute]);
    if (repo.id === "kimi-toolchain") candidateRoots.add(projectRoot);

    let matched = false;
    for (const root of candidateRoots) {
      const pkgPath = join(root, "package.json");
      if (!pathExists(pkgPath)) continue;
      const pkg = safeParse(readText(pkgPath), {} as { name?: string });
      if (pkg.name === expectedName) {
        matched = true;
        break;
      }
    }

    if (matched) continue;

    if (!pathExists(absolute)) {
      violations.push(`repo "${repo.id}": clonePath "${repo.clonePath}" does not exist`);
      continue;
    }

    violations.push(
      `repo "${repo.id}": clonePath "${repo.clonePath}" missing package.json name "${expectedName}"`
    );
  }

  return violations;
}

/** Combined repo reference lint — URLs, duplicates, provides links, ecosystem pairing, clone paths. */
export function lintRepoReferences(options: LintRepoClonePathsOptions = {}): string[] {
  return [
    ...lintRepoUrls(),
    ...lintRepoDuplicateKeys(),
    ...lintRepoProvidesLinks(),
    ...lintEcosystemRepoCompleteness(),
    ...lintLocalDocSyncPaths(),
    ...lintLocalDocSyncDuplicateRepoPaths(),
    ...lintRepoClonePaths(options),
  ];
}

/**
 * Lint: verify ecosystem ↔ repo pairing completeness.
 * Returns violation strings; empty array = OK.
 */
export function lintEcosystemRepoCompleteness(): string[] {
  const violations: string[] = [];
  const linkedKinds: ReferenceKind[] = ["library", "runtime", "product"];

  for (const ref of ECOSYSTEM_REFERENCES) {
    if (ref.noRepo) continue;
    if (!linkedKinds.includes(ref.kind)) continue;
    const repo = resolveRepoForEcosystem(ref);
    if (!repo) {
      const convention = `${ref.id}-upstream`;
      violations.push(
        `ecosystem "${ref.id}" (${ref.kind}): no repo entry found — add repoId or create REPO_REFERENCES entry "${convention}", or set noRepo: true`
      );
    }
  }

  for (const repo of REPO_REFERENCES) {
    const provides = repo.provides ?? [];
    if (provides.length > 0) continue;
    if (repo.role === "tool") continue;
    if (!repo.clonePath) continue;

    const hasCounterpart = ECOSYSTEM_REFERENCES.some(
      (e) => (e.repoId ?? `${e.id}-upstream`) === repo.id
    );
    if (!hasCounterpart) {
      violations.push(
        `repo "${repo.id}" has clonePath but no ecosystem entry references it — add provides, repoId on ecosystem, or remove clonePath`
      );
    }
  }

  return violations;
}

export function ecosystemReferenceById(id: string): EcosystemReference | undefined {
  return ECOSYSTEM_BY_ID[id as EcosystemId];
}

export function localDocReferenceById(id: string): LocalDocReference | undefined {
  return LOCAL_DOC_BY_ID[id as LocalDocId];
}

/** True when `repoPath` is repo-root relative (no directory separator). */
export function isRootLocalDocRepoPath(repoPath: string): boolean {
  return !repoPath.includes("/");
}

/** All unique `repoPath` values indexed as local docs (root + nested). */
export function collectLocalDocSyncPaths(): readonly string[] {
  const paths = new Set<string>();
  for (const doc of LOCAL_DOC_REFERENCES) paths.add(doc.repoPath);
  return [...paths].sort();
}

/** Deduped localDoc rows for sync — one entry per `repoPath`. */
export function collectLocalDocSyncEntries(): readonly LocalDocReference[] {
  const byRepoPath = new Map<string, LocalDocReference>();
  for (const doc of LOCAL_DOC_REFERENCES) {
    if (!byRepoPath.has(doc.repoPath)) byRepoPath.set(doc.repoPath, doc);
  }
  return [...byRepoPath.values()].sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}

/** Strip `~/.kimi-code/` prefix — desktop-relative destination for a localDoc row. */
export function localDocDesktopRelativePath(runtimePath: string): string {
  if (!runtimePath.startsWith(KIMI_CODE_RUNTIME_PREFIX)) {
    throw new Error(`runtimePath must start with ${KIMI_CODE_RUNTIME_PREFIX}: ${runtimePath}`);
  }
  return runtimePath.slice(KIMI_CODE_RUNTIME_PREFIX.length);
}

/**
 * `LOCAL_DOC_REFERENCES` rows synced flat to `~/.kimi-code/`.
 * Rule: every localDoc whose `repoPath` has no `/` is a root sync target.
 */
export function collectRootLocalDocSyncPaths(): readonly string[] {
  return collectLocalDocSyncPaths().filter(isRootLocalDocRepoPath);
}

/** Lint: every localDoc must declare `runtimePath` as `~/.kimi-code/<repoPath>`. */
export function lintLocalDocSyncPaths(): string[] {
  const violations: string[] = [];
  for (const doc of LOCAL_DOC_REFERENCES) {
    const expected = `${KIMI_CODE_RUNTIME_PREFIX}${doc.repoPath}`;
    if (doc.runtimePath !== expected) {
      violations.push(
        `localDoc "${doc.id}": sync runtimePath must be "${expected}", got "${doc.runtimePath}"`
      );
    }
  }
  return violations;
}

/** Lint: duplicate repoPath rows must share the same runtimePath. */
export function lintLocalDocSyncDuplicateRepoPaths(): string[] {
  const violations: string[] = [];
  const seen = new Map<string, LocalDocReference>();
  for (const doc of LOCAL_DOC_REFERENCES) {
    const prev = seen.get(doc.repoPath);
    if (prev && prev.runtimePath !== doc.runtimePath) {
      violations.push(
        `localDoc duplicate repoPath "${doc.repoPath}": "${prev.id}" and "${doc.id}" disagree on runtimePath`
      );
    }
    seen.set(doc.repoPath, doc);
  }
  return violations;
}

function docsLink(ref: EcosystemReference): string {
  if (ref.docs.startsWith("http://") || ref.docs.startsWith("https://")) {
    return `[docs](${ref.docs})`;
  }
  return `\`${ref.docs}\``;
}

/** Parse a GitHub repo URL into a short owner/repo display slug and link target. */
export function repoUrlParts(url: string): { display: string; href: string } {
  try {
    const pattern = new URLPattern("https://github.com/:owner/:repo");
    const match = pattern.exec(url);
    if (match?.pathname.groups) {
      const owner = match.pathname.groups.owner ?? "";
      const repo = (match.pathname.groups.repo ?? "").replace(/\.git$/, "");
      if (owner && repo) {
        return { display: `${owner}/${repo}`, href: url };
      }
    }
  } catch {
    // URLPattern unavailable or malformed URL — fall through
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .replace(/\/$/, "")
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (parsed.host.toLowerCase() === "github.com" && segments.length >= 2) {
      return { display: `${segments[0]}/${segments[1]}`, href: url };
    }
  } catch {
    // ignore
  }

  return { display: url, href: url };
}

function formatRepoRoleProvides(ref: RepoReference): string {
  const parts: string[] = [];
  if (ref.role) parts.push(ref.role);
  if (ref.provides?.length) parts.push(ref.provides.join(", "));
  return parts.join(" / ") || "—";
}

/** Column descriptor for a generic markdown table builder. */
interface ColumnDef<T> {
  header: string;
  cell: (item: T) => string;
  align?: "left" | "center" | "right";
}

/** Escape pipe characters inside a table cell so they don't break column parsing. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/** Render an array of items as a GFM markdown table using column descriptors. */
function buildTable<T>(items: readonly T[], columns: ColumnDef<T>[]): string {
  const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
  const separator =
    "| " +
    columns
      .map((c) => {
        if (c.align === "center") return ":---:";
        if (c.align === "right") return "---:";
        return ":---";
      })
      .join(" | ") +
    " |";
  const dataRows = items.map(
    (item) => "| " + columns.map((c) => escapeCell(c.cell(item))).join(" | ") + " |"
  );
  return [headerRow, separator, ...dataRows].join("\n");
}

const ECOSYSTEM_COLUMNS: ColumnDef<EcosystemReference>[] = [
  { header: "Stack", cell: (e) => e.name },
  { header: "Status", cell: (e) => formatEcosystemReferenceStatus(e.status) },
  { header: "Docs", cell: (e) => docsLink(e) },
  {
    header: "Source repo",
    cell: (e) => {
      const repo = resolveRepoForEcosystem(e);
      return repo ? `[${repo.name}](${repo.url})` : "—";
    },
  },
  { header: "Usage in this repo", cell: (e) => e.usage },
];

const LOCAL_DOC_COLUMNS: ColumnDef<LocalDocReference>[] = [
  { header: "Repo", cell: (d) => `\`${d.repoPath}\`` },
  { header: "Runtime", cell: (d) => `\`${d.runtimePath}\`` },
  { header: "Purpose", cell: (d) => d.purpose },
];

const REPO_COLUMNS: ColumnDef<RepoReference>[] = [
  { header: "Key", cell: (r) => `\`${r.id}\`` },
  { header: "Project", cell: (r) => r.name },
  {
    header: "Source",
    cell: (r) => {
      const { display, href } = repoUrlParts(r.url);
      return `[${display}](${href})`;
    },
  },
  {
    header: "Clone path",
    cell: (r) => (r.clonePath ? `\`${r.clonePath}\`` : "—"),
  },
  { header: "Role / provides", cell: formatRepoRoleProvides },
];

/**
 * Slice full GFM markdown to one inspect section (used by `--watch` and `--section`).
 * Headings: `### Ecosystem`, `### Local docs`, `### Repositories`.
 */
export function filterCanonicalReferencesMarkdownSection(
  md: string,
  section: CanonicalReferencesInspectSection
): string {
  if (section === "all") return md;

  const sectionHeadings: Record<Exclude<CanonicalReferencesInspectSection, "all">, string> = {
    ecosystem: "### Ecosystem",
    docs: "### Local docs",
    repos: "### Repositories",
  };

  const heading = sectionHeadings[section];
  const start = md.indexOf(heading);
  if (start === -1) return md;

  const nextMatch = md.indexOf("\n### ", start + 1);
  const body = nextMatch === -1 ? md.slice(start) : md.slice(start, nextMatch);
  const firstSection = md.indexOf("\n### ");
  const topHeader = firstSection === -1 ? md : md.slice(0, firstSection);
  return `${topHeader}\n${body}`;
}

/** Markdown block for CONTEXT.md (compact) or full tables. */
export function formatCanonicalReferencesMarkdown(
  compact = false,
  section: CanonicalReferencesInspectSection = "all"
): string {
  if (compact) {
    const stacks = ECOSYSTEM_REFERENCES.map((ref) => ref.name).join(", ");
    const body = `## Canonical References

Cached manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (\`bun run references:generate\`; synced to \`~/.kimi-code/\`). Stacks: ${stacks}. Full tables: \`CODE_REFERENCES.md\` § Canonical ecosystem links.

`;
    return filterCanonicalReferencesMarkdownSection(body, section);
  }

  const full = `## Canonical References

Machine-readable manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (synced to \`~/.kimi-code/\`). Regenerate: \`bun run references:generate\`.

### Ecosystem

${buildTable(ECOSYSTEM_REFERENCES, ECOSYSTEM_COLUMNS)}

### Local docs (cached after sync)

${buildTable(LOCAL_DOC_REFERENCES, LOCAL_DOC_COLUMNS)}

### Repositories

${buildTable(REPO_REFERENCES, REPO_COLUMNS)}
`;
  return filterCanonicalReferencesMarkdownSection(full, section);
}

/** Terminal tables for `references:inspect --plain` (ANSI stripped). */
export function formatCanonicalReferencesInspectPlain(
  section: CanonicalReferencesInspectSection = "all"
): string {
  const parts: string[] = [];
  const repoNameById = new Map(REPO_REFERENCES.map((r) => [r.id, r.name]));

  if (section === "all" || section === "ecosystem") {
    const table = Bun.inspect.table(
      ECOSYSTEM_REFERENCES.map((e) => ecosystemReferenceInspectRow(e, repoNameById))
    );
    parts.push(`\nEcosystem references:\n${Bun.stripANSI(table)}`);
  }

  if (section === "all" || section === "repos") {
    const table = Bun.inspect.table(
      REPO_REFERENCES.map((r) => ({
        id: r.id,
        role: r.role ?? "—",
        provides: r.provides?.join(", ") ?? "—",
        clonePath: r.clonePath ?? "—",
        source: repoUrlParts(r.url).display,
      }))
    );
    parts.push(`\nRepository references:\n${Bun.stripANSI(table)}`);
  }

  if (section === "all" || section === "docs") {
    const table = Bun.inspect.table(
      LOCAL_DOC_REFERENCES.map((d) => ({
        id: d.id,
        repoPath: d.repoPath,
        canvas: d.cursorCanvas ? "yes" : "—",
        readOrder: d.canvasReadOrder ?? "—",
      }))
    );
    parts.push(`\nLocal doc references:\n${Bun.stripANSI(table)}`);
  }

  return parts.join("\n");
}
