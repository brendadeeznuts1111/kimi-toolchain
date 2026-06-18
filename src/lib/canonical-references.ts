/**
 * Canonical ecosystem and documentation links — single source of truth.
 * Generated JSON: canonical-references.json (repo root + ~/.kimi-code/ after sync).
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { canonicalReferencesPath } from "./paths.ts";
import { TOOLCHAIN_VERSION } from "./version.ts";
import { stableStringify } from "./build-constants-registry.ts";

export const CANONICAL_REFERENCES_SCHEMA_VERSION = 1;
export const CANONICAL_REFERENCES_FILENAME = "canonical-references.json";

export type ReferenceKind =
  | "runtime"
  | "library"
  | "product"
  | "platform"
  | "docs"
  | "repo"
  | "mcp";

export interface EcosystemReference {
  id: string;
  name: string;
  kind: ReferenceKind;
  homepage: string;
  docs: string;
  /** npm package name when applicable */
  package?: string;
  /** When agents should reach for this stack */
  usage: string;
  minVersion?: string;
  install?: string;
}

/**
 * Manifest index row for a local documentation file.
 * These are path pointers and human-readable purposes —
 * NOT `dx.config.toml` keys. Boundary semantics (toolchain vs Herdr,
 * global vs project) live in the doc content at id `namespace`.
 */
export interface LocalDocReference {
  id: string;
  repoPath: string;
  runtimePath: string;
  purpose: string;
}

export interface RepoReference {
  id: string;
  name: string;
  url: string;
  clonePath?: string;
}

export interface CanonicalReferencesManifest {
  schemaVersion: typeof CANONICAL_REFERENCES_SCHEMA_VERSION;
  generatedAt: string;
  toolchainVersion: string;
  ecosystem: EcosystemReference[];
  localDocs: LocalDocReference[];
  repos: RepoReference[];
}

/** Authoritative link table — edit here; run `bun run references:generate`. */
export const ECOSYSTEM_REFERENCES: readonly EcosystemReference[] = [
  {
    id: "bun",
    name: "Bun",
    kind: "runtime",
    homepage: "https://bun.sh",
    docs: "https://bun.sh/docs",
    package: "bun",
    usage: "Runtime, test runner, package manager, and native I/O for kimi-toolchain",
    minVersion: "1.4.0",
  },
  {
    id: "effect",
    name: "Effect",
    kind: "library",
    homepage: "https://effect.website",
    docs: "https://effect.website/docs",
    package: "effect",
    usage: "Typed errors, CLI/runtime adapters, and Herdr pane orchestration in src/lib/effect/",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    kind: "product",
    homepage: "https://moonshotai.github.io/kimi-code/",
    docs: "https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html",
    usage: "Official agent CLI (`kimi`), config.toml, sessions, MCP — distinct from `kimi-doctor`",
    install: "https://code.kimi.com/kimi-code/install.sh",
  },
  {
    id: "herdr",
    name: "Herdr",
    kind: "product",
    homepage: "https://herdr.dev",
    docs: "https://herdr.dev/docs/",
    usage: "Terminal-native multiplexer; socket API for herdr-pane, herdr-latm, herdr-orchestrator",
    install: "https://herdr.dev/install.sh",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Platform",
    kind: "platform",
    homepage: "https://developers.cloudflare.com/",
    docs: "https://developers.cloudflare.com/workers/",
    usage:
      "Workers, Access, MCP; use kimi-cloudflare-access for API tokens (separate from Wrangler OAuth)",
  },
  {
    id: "cloudflare-mcp",
    name: "Cloudflare MCP",
    kind: "mcp",
    homepage: "https://mcp.cloudflare.com/mcp",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-server/",
    usage:
      "Default user MCP `cloudflare-api`; optional docs/bindings/builds/observability endpoints",
  },
  {
    id: "dx",
    name: "DX",
    kind: "product",
    homepage: "https://github.com/brendadeeznuts1111/dx-config",
    docs: "~/.config/dx/AGENTS.md",
    usage:
      "Global Bun dev platform — `dx config`, `dx mcp-status`, `dx.config.toml` herdr/finishWork",
  },
  {
    id: "oxc",
    name: "Oxc (oxfmt / oxlint)",
    kind: "library",
    homepage: "https://oxc.rs",
    docs: "https://oxc.rs/docs/guide/usage/formatter.html",
    package: "oxfmt",
    usage: "Format and lint gates — no ESLint in this repo",
  },
] as const;

export const LOCAL_DOC_REFERENCES: readonly LocalDocReference[] = [
  {
    id: "agents",
    repoPath: "AGENTS.md",
    runtimePath: "~/.kimi-code/AGENTS.md",
    purpose: "Toolchain agent guide",
  },
  {
    id: "code-references",
    repoPath: "CODE_REFERENCES.md",
    runtimePath: "~/.kimi-code/CODE_REFERENCES.md",
    purpose: "Local coding exemplars",
  },
  {
    id: "unified",
    repoPath: "UNIFIED.md",
    runtimePath: "~/.kimi-code/UNIFIED.md",
    purpose: "Kimi Code vs kimi-toolchain matrix",
  },
  {
    id: "deep-quality",
    repoPath: "DEEP-QUALITY.md",
    runtimePath: "~/.kimi-code/DEEP-QUALITY.md",
    purpose: "Effect-discipline floor and gate JSON shapes",
  },
  {
    id: "templates",
    repoPath: "TEMPLATES.md",
    runtimePath: "~/.kimi-code/TEMPLATES.md",
    purpose: "Scaffold templates",
  },
  {
    id: "dashboard-thumbnails",
    repoPath: "docs/references/dashboard-thumbnails.md",
    runtimePath: "~/.kimi-code/docs/references/dashboard-thumbnails.md",
    purpose:
      "Herdr dashboard thumbnail pipeline; meta.webview; WebView dataStore vs in-memory cache",
  },
  {
    id: "kimi-doctor",
    repoPath: "docs/references/kimi-doctor.md",
    runtimePath: "~/.kimi-code/docs/references/kimi-doctor.md",
    purpose:
      "Dashboard automation gate (kimi-doctor --automation): CLI, JSON schema, exit codes, and failure modes",
  },
  {
    id: "namespace",
    repoPath: "docs/references/namespace.md",
    runtimePath: "~/.kimi-code/docs/references/namespace.md",
    purpose:
      "Toolchain vs Herdr plugin namespace; doctor trinity (kimi-doctor, herdr-doctor bin/plugin, kimi doctor); global ecosystem; finish-work vs prefix keybindings",
  },
  {
    id: "shell-spawn-choice",
    repoPath: "docs/references/shell-spawn-choice.md",
    runtimePath: "~/.kimi-code/docs/references/shell-spawn-choice.md",
    purpose: "invokeTool vs Bun.spawn vs governedSpawn decision matrix",
  },
  {
    id: "bun-shell-companions",
    repoPath: "docs/references/bun-shell-companions.md",
    runtimePath: "~/.kimi-code/docs/references/bun-shell-companions.md",
    purpose: "Bun $ template vs subprocess and inspect companion patterns",
  },
  {
    id: "canonical-references",
    repoPath: CANONICAL_REFERENCES_FILENAME,
    runtimePath: `~/.kimi-code/${CANONICAL_REFERENCES_FILENAME}`,
    purpose: "Cached canonical ecosystem links (this manifest)",
  },
] as const;

export const REPO_REFERENCES: readonly RepoReference[] = [
  {
    id: "kimi-toolchain",
    name: "kimi-toolchain",
    url: "https://github.com/brendadeeznuts1111/kimi-toolchain",
    clonePath: "~/kimi-toolchain",
  },
  {
    id: "kimi-code-upstream",
    name: "Kimi Code (Moonshot)",
    url: "https://github.com/MoonshotAI/kimi-code",
  },
  {
    id: "effect-upstream",
    name: "Effect",
    url: "https://github.com/Effect-TS/effect",
  },
] as const;

/** Repo-root manifest path (not the synced runtime copy — use paths.canonicalReferencesPath). */
export function repoCanonicalReferencesPath(projectRoot: string): string {
  return join(projectRoot, CANONICAL_REFERENCES_FILENAME);
}

export function buildCanonicalReferencesManifest(): CanonicalReferencesManifest {
  return {
    schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    toolchainVersion: TOOLCHAIN_VERSION,
    ecosystem: [...ECOSYSTEM_REFERENCES],
    localDocs: [...LOCAL_DOC_REFERENCES],
    repos: [...REPO_REFERENCES],
  };
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
    const parsed: unknown = await Bun.file(filePath).json();
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
      applicable: pathExists(join(projectRoot, "src/lib/canonical-references.ts")),
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
      message: "repo manifest stale vs src/lib/canonical-references.ts",
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
      const pkg = (await Bun.file(pkgPath).json()) as {
        kimi?: { canonicalReferences?: string };
      };
      const pointer = pkg.kimi?.canonicalReferences;
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

export function manifestNeedsRefresh(
  generated: CanonicalReferencesManifest,
  existing: CanonicalReferencesManifest | null
): boolean {
  if (!existing) return true;
  return !referencesContentEqual(generated, existing);
}

export function ecosystemReferenceById(id: string): EcosystemReference | undefined {
  return ECOSYSTEM_REFERENCES.find((ref) => ref.id === id);
}

export function localDocReferenceById(id: string): LocalDocReference | undefined {
  return LOCAL_DOC_REFERENCES.find((r) => r.id === id);
}

function docsLink(ref: EcosystemReference): string {
  if (ref.docs.startsWith("http://") || ref.docs.startsWith("https://")) {
    return `[docs](${ref.docs})`;
  }
  return `\`${ref.docs}\``;
}

/** Markdown block for CONTEXT.md (compact) or full tables. */
export function formatCanonicalReferencesMarkdown(compact = false): string {
  if (compact) {
    const stacks = ECOSYSTEM_REFERENCES.map((ref) => ref.name).join(", ");
    return `## Canonical References

Cached manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (\`bun run references:generate\`; synced to \`~/.kimi-code/\`). Stacks: ${stacks}. Full tables: \`CODE_REFERENCES.md\` § Canonical ecosystem links.

`;
  }

  const ecoRows = ECOSYSTEM_REFERENCES.map(
    (ref) => `| ${ref.name} | ${docsLink(ref)} | ${ref.usage} |`
  ).join("\n");
  const docRows = LOCAL_DOC_REFERENCES.map(
    (ref) => `| \`${ref.repoPath}\` | \`${ref.runtimePath}\` | ${ref.purpose} |`
  ).join("\n");
  const repoRows = REPO_REFERENCES.map(
    (ref) => `| ${ref.name} | ${ref.url}${ref.clonePath ? ` (\`${ref.clonePath}\`)` : ""} |`
  ).join("\n");

  return `## Canonical References

Machine-readable manifest: \`${CANONICAL_REFERENCES_FILENAME}\` (synced to \`~/.kimi-code/\`). Regenerate: \`bun run references:generate\`.

### Ecosystem

| Stack | Docs | Usage in this repo |
| ----- | ---- | ------------------ |
${ecoRows}

### Local docs (cached after sync)

| Repo | Runtime | Purpose |
| ---- | ------- | ------- |
${docRows}

### Repositories

| Project | URL |
| ------- | --- |
${repoRows}
`;
}
