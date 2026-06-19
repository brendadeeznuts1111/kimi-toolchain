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
  /** Repo-relative Cursor Canvas path; IDE-only pointer — not synced to ~/.kimi-code/ */
  cursorCanvas?: string;
  /** Canvas display page name (e.g. "Doc links"). Matches CANVAS_ROUTING.page. */
  canvasPage?: string;
  /** Canvas self-identifier (e.g. "doc-links-and-see-ladder"). Matches CANVAS_ROUTING.id. */
  canvasId?: string;
  /** Canvas version string (e.g. "0.1.0"). From CANVAS_ROUTING.version. */
  canvasVersion?: string;
  /** Canvas layer label (e.g. "Doc URL lint"). From CANVAS_ROUTING.layer. */
  canvasLayer?: string;
  /** When to open hint (e.g. "@see ladder · docs/references"). From CANVAS_ROUTING.openWhen. */
  canvasOpenWhen?: string;
  /** Read-order grouping (1=Hub, 2=Config/Namespace, 3=Cross-ref, 4=Scaffold, 5-6=Herdr). */
  canvasReadOrder?: number;
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
    purpose: "Local coding exemplars; doc-links lint and @see ladder",
    cursorCanvas: "docs/canvases/doc-links-and-see-ladder.canvas.tsx",
    canvasId: "doc-links-and-see-ladder",
    canvasPage: "Doc links",
    canvasVersion: "0.1.0",
    canvasLayer: "Doc URL lint",
    canvasOpenWhen: "@see ladder · docs/references index",
    canvasReadOrder: 4,
  },
  {
    id: "unified",
    repoPath: "UNIFIED.md",
    runtimePath: "~/.kimi-code/UNIFIED.md",
    purpose: "Kimi Code vs kimi-toolchain matrix",
    cursorCanvas: "docs/canvases/kimi-toolchain.canvas.tsx",
    canvasId: "kimi-toolchain",
    canvasPage: "Hub",
    canvasVersion: "0.1.0",
    canvasLayer: "Project hub",
    canvasOpenWhen: "Architecture, tools, gates — start here",
    canvasReadOrder: 1,
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
    purpose: "Scaffold templates — profiles, snippets, bun create flow, kimi-fix usage",
    cursorCanvas: "docs/canvases/kimi-fix.canvas.tsx",
    canvasId: "kimi-fix",
    canvasPage: "Scaffold",
    canvasVersion: "0.1.0",
    canvasLayer: "kimi-fix · bun create",
    canvasOpenWhen: "Profiles · templates · scaffold doctor",
    canvasReadOrder: 5,
  },
  {
    id: "dashboard-thumbnails",
    repoPath: "docs/references/dashboard-thumbnails.md",
    runtimePath: "~/.kimi-code/docs/references/dashboard-thumbnails.md",
    purpose:
      "Herdr dashboard thumbnail pipeline; meta.webview; WebView dataStore vs in-memory cache",
    cursorCanvas: "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx",
    canvasId: "herdr-dashboard-thumbnails",
    canvasPage: "Orchestrator HTTP",
    canvasVersion: "0.1.0",
    canvasLayer: "Orchestrator HTTP",
    canvasOpenWhen: "PNG → Bun.Image → /api/thumbnail",
    canvasReadOrder: 6,
  },
  {
    id: "kimi-doctor",
    repoPath: "docs/references/kimi-doctor.md",
    runtimePath: "~/.kimi-code/docs/references/kimi-doctor.md",
    purpose:
      "Dashboard automation gate (kimi-doctor --automation): CLI, JSON schema, exit codes, and failure modes",
    cursorCanvas: "docs/canvases/herdr-dashboard-automation.canvas.tsx",
    canvasId: "herdr-dashboard-automation",
    canvasPage: "Finish-work shell",
    canvasVersion: "1.0.0",
    canvasLayer: "Finish-work shell",
    canvasOpenWhen: "kimi-doctor --automation · gate JSON",
    canvasReadOrder: 7,
  },
  {
    id: "herdr-socket-saturation-protocol",
    repoPath: "docs/references/herdr-socket-saturation-protocol.md",
    runtimePath: "~/.kimi-code/docs/references/herdr-socket-saturation-protocol.md",
    purpose:
      "Herdr EAGAIN (os error 35) taxonomy, fix-socket --dry-run/--live contract, respawn protection, and Mac mini runbook",
  },
  {
    id: "namespace",
    repoPath: "docs/references/namespace.md",
    runtimePath: "~/.kimi-code/docs/references/namespace.md",
    purpose:
      "Toolchain vs Herdr plugin namespace; doctor trinity (kimi-doctor, herdr-doctor bin/plugin, kimi doctor); global ecosystem; finish-work vs prefix keybindings",
    cursorCanvas: "docs/canvases/namespace-boundaries.canvas.tsx",
    canvasId: "namespace-boundaries",
    canvasPage: "Meta / routing",
    canvasVersion: "0.1.0",
    canvasLayer: "Meta / routing",
    canvasOpenWhen: "Doctor trinity · finish-work vs prefix+*",
    canvasReadOrder: 2,
  },
  {
    id: "configuration-layers",
    repoPath: "docs/references/configuration-layers.md",
    runtimePath: "~/.kimi-code/docs/references/configuration-layers.md",
    purpose:
      "Four-layer model: discovery (canonical-references), define registry (constants-manifest), cross-repo parity (constants-parity.toml), app scaffold (templates/scaffold/bunfig.toml)",
    cursorCanvas: "docs/canvases/configuration-layers.canvas.tsx",
    canvasId: "configuration-layers",
    canvasPage: "Config SSOT",
    canvasVersion: "1.0.0",
    canvasLayer: "Config SSOT",
    canvasOpenWhen: "Discovery · define · parity · scaffold layers",
    canvasReadOrder: 3,
  },
  {
    id: "shell-spawn-choice",
    repoPath: "docs/references/shell-spawn-choice.md",
    runtimePath: "~/.kimi-code/docs/references/shell-spawn-choice.md",
    purpose: "invokeTool vs Bun.spawn vs governedSpawn decision matrix",
  },
  {
    id: "bun-runtime-scaffold",
    repoPath: "docs/references/bun-runtime-scaffold.md",
    runtimePath: "~/.kimi-code/docs/references/bun-runtime-scaffold.md",
    purpose:
      "Bun install config (bunfig.toml merge order, defaults, env vars, backend, cache/lazy install)",
  },
  {
    id: "bun-shell-companions",
    repoPath: "docs/references/bun-shell-companions.md",
    runtimePath: "~/.kimi-code/docs/references/bun-shell-companions.md",
    purpose: "Bun $ template vs subprocess and inspect companion patterns",
  },
  {
    id: "template-matrix",
    repoPath: "docs/references/template-matrix.md",
    runtimePath: "~/.kimi-code/docs/references/template-matrix.md",
    purpose:
      "Template families matrix: scaffold breakdown (22 files), bridge pattern collision resolution, runtime sync paths, profile differentiation",
  },
  {
    id: "herdr-plugin-architecture",
    repoPath: "docs/references/herdr-plugin-architecture.md",
    runtimePath: "~/.kimi-code/docs/references/herdr-plugin-architecture.md",
    purpose:
      "Herdr unified plugin plan v0.5.0 — prefix+* actions, STATE_DIR topology; orthogonal to [finishWork].gates",
    cursorCanvas: "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx",
    canvasId: "herdr-unified-plugin-architecture",
    canvasPage: "Herdr plugins",
    canvasVersion: "0.5.0",
    canvasLayer: "Herdr plugins v0.5.0",
    canvasOpenWhen: "prefix+* · orthogonal to finish-work gates",
    canvasReadOrder: 8,
  },
  {
    id: "v53-architecture",
    repoPath: "docs/references/v53-architecture.md",
    runtimePath: "~/.kimi-code/docs/references/v53-architecture.md",
    purpose:
      "v5.3 architecture consolidated reference: 9-file map, awk splitter, profile registry, DEFAULT_MODULES, MODULE_REGISTRY, 42-card dashboard, Herdr integration",
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
