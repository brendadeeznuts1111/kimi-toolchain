import { makeDir, readText, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  CANONICAL_REFERENCES_FILENAME,
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  type CanonicalReferencesManifest,
  ECOSYSTEM_BY_ID,
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_BY_ID,
  LOCAL_DOC_REFERENCES,
  REPO_BY_ID,
  REPO_REFERENCES,
  auditCanonicalReferencesHealth,
  auditEcosystemReferenceUrlsOnline,
  checkEcosystemReferenceUrl,
  collectEcosystemHttpUrls,
  evaluateProbeHandoffCondition,
  resolveProbeHealthCheck,
  buildCanonicalReferencesManifest,
  collectLocalDocSyncEntries,
  collectLocalDocSyncPaths,
  collectRootLocalDocSyncPaths,
  ecosystemReferenceById,
  ecosystemReferenceInspectRow,
  formatEcosystemReferenceStatus,
  resolveEcosystemReferenceStatus,
  isRootLocalDocRepoPath,
  lintLocalDocSyncPaths,
  localDocDesktopRelativePath,
  filterCanonicalReferencesMarkdownSection,
  formatCanonicalReferencesInspectPlain,
  formatCanonicalReferencesMarkdown,
  formatEcosystemReferenceUrlReport,
  isHttpReferenceUrl,
  repoUrlParts,
  getRepo,
  getRepoByUrl,
  getRepoIdByUrl,
  isCanonicalReferencesManifest,
  lintRepoClonePaths,
  lintRepoDuplicateKeys,
  lintRepoProvidesLinks,
  lintRepoReferences,
  lintRepoUrls,
  lintCanonicalReferencesLinkTables,
  lintManifestBunNative,
  buildCanonicalReferencesManifestFromTables,
  finalizeCanonicalReferencesManifest,
  manifestNeedsRefresh,
  normalizeRepoUrl,
  referencesContentEqual,
} from "../src/lib/canonical-references.ts";
import {
  extractCanonicalReferencesTypesPrefix,
  generateCanonicalReferencesDataTs,
  lintCanonicalReferencesToml,
  parseCanonicalReferencesToml,
  serializeCanonicalReferencesToml,
  type CanonicalReferencesTomlSource,
} from "../src/lib/canonical-references-toml.ts";
import { stableStringify } from "../src/lib/build-constants-registry.ts";

function canonicalDataTypesPrefix(): string {
  return extractCanonicalReferencesTypesPrefix(
    readText(join(REPO_ROOT, "src/lib/canonical-references-data.ts"))
  );
}

describe("canonical-references", () => {
  test("ecosystem includes bun, effect, kimi-code, herdr", () => {
    const ids = ECOSYSTEM_REFERENCES.map((ref) => ref.id);
    expect(ids).toContain("bun");
    expect(ids).toContain("effect");
    expect(ids).toContain("kimi-code");
    expect(ids).toContain("herdr");
  });

  test("buildCanonicalReferencesManifest matches schema", () => {
    const manifest = buildCanonicalReferencesManifest();
    expect(isCanonicalReferencesManifest(manifest)).toBe(true);
    expect(manifest.schemaVersion).toBe(CANONICAL_REFERENCES_SCHEMA_VERSION);
    expect(manifest.ecosystem.length).toBe(ECOSYSTEM_REFERENCES.length);
    expect(manifest.localDocs.length).toBe(LOCAL_DOC_REFERENCES.length);
    expect(manifest.repos.length).toBe(REPO_REFERENCES.length);
  });

  test("formatEcosystemReferenceStatus maps lifecycle icons for inspect tables", () => {
    expect(formatEcosystemReferenceStatus()).toBe("✅ active");
    expect(formatEcosystemReferenceStatus("deprecated")).toBe("⚠️ deprecated");
    expect(formatEcosystemReferenceStatus("experimental")).toBe("🧪 experimental");
    expect(formatEcosystemReferenceStatus("external-fork")).toBe("🍴 external-fork");
    expect(resolveEcosystemReferenceStatus()).toBe("active");
    expect(Bun.deepEquals(formatEcosystemReferenceStatus("deprecated"), "⚠\uFE0F deprecated")).toBe(
      true
    );
  });

  test("ecosystemReferenceInspectRow uses formatted status column", () => {
    const repoNameById = new Map(REPO_REFERENCES.map((r) => [r.id, r.name]));
    const row = ecosystemReferenceInspectRow(ECOSYSTEM_BY_ID["bun"], repoNameById);
    expect(row.status).toBe("✅ active");
    expect(row.repoId).toBe("bun-upstream");
  });

  test("ecosystemReferenceById resolves docs URLs", () => {
    const bun = ecosystemReferenceById("bun");
    expect(bun?.docs).toBe("https://bun.sh/docs");
    const effect = ecosystemReferenceById("effect");
    expect(effect?.package).toBe("effect");
  });

  test("manifestNeedsRefresh detects content drift but ignores generatedAt", () => {
    const generated = buildCanonicalReferencesManifest();
    const stale = { ...generated, generatedAt: "1970-01-01T00:00:00.000Z" };
    expect(manifestNeedsRefresh(generated, null)).toBe(true);
    expect(manifestNeedsRefresh(generated, stale)).toBe(false);
    expect(
      manifestNeedsRefresh(generated, {
        ...generated,
        ecosystem: [],
      })
    ).toBe(true);
  });

  test("localDocs includes docs/references entries", () => {
    for (const id of [
      "dashboard-thumbnails",
      "kimi-doctor",
      "namespace",
      "configuration-layers",
      "canonical-references-system",
      "shell-spawn-choice",
      "bun-runtime-scaffold",
      "testing-execution",
      "bun-shell-companions",
      "template-matrix",
      "herdr-plugin-architecture",
    ]) {
      const entry = LOCAL_DOC_REFERENCES.find((ref) => ref.id === id);
      expect(entry?.repoPath).toStartWith("docs/references/");
      expect(entry?.runtimePath).toStartWith("~/.kimi-code/docs/references/");
    }
  });

  test("all cursorCanvas pointers resolve to docs/canvases/", () => {
    const expected: Record<string, string> = {
      unified: "docs/canvases/kimi-toolchain.canvas.tsx",
      templates: "docs/canvases/kimi-fix.canvas.tsx",
      namespace: "docs/canvases/namespace-boundaries.canvas.tsx",
      "configuration-layers": "docs/canvases/configuration-layers.canvas.tsx",
      "code-references": "docs/canvases/doc-links-and-see-ladder.canvas.tsx",
      "kimi-doctor": "docs/canvases/herdr-dashboard-automation.canvas.tsx",
      "dashboard-thumbnails": "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx",
      "herdr-plugin-architecture": "docs/canvases/herdr-unified-plugin-architecture.canvas.tsx",
      "deep-quality": "docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx",
      "v53-architecture": "docs/canvases/dashboard-card-registry.canvas.tsx",
      "artifact-lineage": "docs/canvases/artifact-lineage.canvas.tsx",
      "gate-health": "docs/canvases/gate-health.canvas.tsx",
      benchmark: "docs/canvases/benchmark.canvas.tsx",
    };
    const withCanvas = LOCAL_DOC_REFERENCES.filter((ref) => ref.cursorCanvas);
    expect(withCanvas.length).toBe(Object.keys(expected).length);
    for (const [id, path] of Object.entries(expected)) {
      const entry = LOCAL_DOC_REFERENCES.find((ref) => ref.id === id);
      expect(entry?.cursorCanvas).toBe(path);
      const row = buildCanonicalReferencesManifest().localDocs.find((ref) => ref.id === id);
      expect(row?.cursorCanvas).toBe(path);
    }
  });

  test("configuration-layers includes cursorCanvas pointer", () => {
    const entry = LOCAL_DOC_REFERENCES.find((ref) => ref.id === "configuration-layers");
    expect(entry?.cursorCanvas).toBe("docs/canvases/configuration-layers.canvas.tsx");
    const manifest = buildCanonicalReferencesManifest();
    const row = manifest.localDocs.find((ref) => ref.id === "configuration-layers");
    expect(row?.cursorCanvas).toBe("docs/canvases/configuration-layers.canvas.tsx");
  });

  test("templates includes kimi-fix cursorCanvas pointer", () => {
    const entry = LOCAL_DOC_REFERENCES.find((ref) => ref.id === "templates");
    expect(entry?.cursorCanvas).toBe("docs/canvases/kimi-fix.canvas.tsx");
  });

  test("unified and namespace include cursorCanvas pointers", () => {
    const unified = LOCAL_DOC_REFERENCES.find((ref) => ref.id === "unified");
    expect(unified?.cursorCanvas).toBe("docs/canvases/kimi-toolchain.canvas.tsx");

    const namespace = LOCAL_DOC_REFERENCES.find((ref) => ref.id === "namespace");
    expect(namespace?.cursorCanvas).toBe("docs/canvases/namespace-boundaries.canvas.tsx");

    const manifest = buildCanonicalReferencesManifest();
    expect(manifest.localDocs.find((ref) => ref.id === "unified")?.cursorCanvas).toBe(
      "docs/canvases/kimi-toolchain.canvas.tsx"
    );
    expect(manifest.localDocs.find((ref) => ref.id === "namespace")?.cursorCanvas).toBe(
      "docs/canvases/namespace-boundaries.canvas.tsx"
    );
  });

  test("REPO_BY_ID and getRepo provide O(1) typed lookup", () => {
    expect(getRepo("kimi-toolchain").name).toBe("kimi-toolchain");
    expect(REPO_BY_ID["effect-upstream"].provides).toEqual(["effect"]);
    expect(getRepo("oxc-upstream").language).toBe("rust");
  });

  test("getRepoByUrl resolves ids from GitHub URLs", () => {
    expect(getRepoByUrl("https://github.com/Effect-TS/effect")?.id).toBe("effect-upstream");
    expect(getRepoByUrl("https://github.com/Effect-TS/effect.git")?.id).toBe("effect-upstream");
    expect(normalizeRepoUrl("https://GitHub.com/MoonshotAI/kimi-code/")).toContain("kimi-code");
    expect(getRepoByUrl("https://github.com/brendadeeznuts1111/kimi-toolchain")?.role).toBe("tool");
    expect(getRepoIdByUrl("https://github.com/oxc-project/oxc")).toBe("oxc-upstream");
    expect(getRepoIdByUrl("https://example.com/unknown")).toBeUndefined();
  });

  test("lintRepoDuplicateKeys and lintRepoProvidesLinks pass for canonical manifest", () => {
    expect(lintRepoDuplicateKeys()).toEqual([]);
    expect(lintRepoProvidesLinks()).toEqual([]);
    expect(lintRepoUrls()).toEqual([]);
  });

  test("lintRepoClonePaths accepts projectRoot for kimi-toolchain worktrees", () => {
    expect(lintRepoClonePaths({ projectRoot: REPO_ROOT, skipFilesystem: false })).toEqual([]);
    expect(lintRepoClonePaths({ skipFilesystem: true })).toEqual([]);
  });

  test("lintRepoReferences passes for canonical repo manifest", () => {
    expect(lintRepoReferences({ projectRoot: REPO_ROOT })).toEqual([]);
  });

  test("collectLocalDocSyncPaths includes root and nested manifest docs", () => {
    const paths = collectLocalDocSyncPaths();
    expect(paths).toContain(CANONICAL_REFERENCES_FILENAME);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("DEEP-QUALITY.md");
    expect(paths).toContain("docs/references/testing-execution.md");
    expect(paths).toContain("docs/handoff-rules.md");
    expect(collectRootLocalDocSyncPaths().every((p) => isRootLocalDocRepoPath(p))).toBe(true);
    expect(lintLocalDocSyncPaths()).toEqual([]);
    expect(collectLocalDocSyncEntries().length).toBe(paths.length);
    for (const entry of collectLocalDocSyncEntries()) {
      expect(localDocDesktopRelativePath(entry.runtimePath)).toBe(entry.repoPath);
    }
  });

  test("repo metadata includes description, defaultBranch, and ciStatusUrl", () => {
    const toolchain = REPO_REFERENCES.find((r) => r.id === "kimi-toolchain");
    expect(toolchain?.description).toContain("Bun-native");
    expect(toolchain?.defaultBranch).toBe("main");
    expect(toolchain?.ciStatusUrl).toContain("/actions");
    expect(toolchain?.frameworks).toContain("bun");
  });

  test("repoUrlParts shortens GitHub URLs to owner/repo slugs", () => {
    expect(repoUrlParts("https://github.com/Effect-TS/effect")).toEqual({
      display: "Effect-TS/effect",
      href: "https://github.com/Effect-TS/effect",
    });
    expect(repoUrlParts("https://github.com/oxc-project/oxc.git").display).toBe("oxc-project/oxc");
    expect(repoUrlParts("https://example.com/foo").display).toBe("https://example.com/foo");
  });

  test("formatCanonicalReferencesMarkdown section filter keeps one table", () => {
    const repos = formatCanonicalReferencesMarkdown(false, "repos");
    expect(repos).toContain("### Repositories");
    expect(repos).not.toContain("### Ecosystem");
    const all = formatCanonicalReferencesMarkdown(false, "all");
    expect(all).toContain("### Ecosystem");
    expect(all).toContain("### Repositories");
    expect(filterCanonicalReferencesMarkdownSection(all, "docs")).toContain("### Local docs");
  });

  test("formatCanonicalReferencesMarkdown renders repository table columns", () => {
    const md = formatCanonicalReferencesMarkdown();
    expect(md).toContain("canonical-references.json");
    expect(md).toContain("https://bun.sh/docs");
    expect(md).toContain("https://effect.website/docs");
    expect(md).toContain("https://herdr.dev/docs/");
    expect(md).toContain("| Key | Project | Source | Clone path | Role / provides |");
    expect(md).toContain("`effect-upstream`");
    expect(md).toContain("[Effect-TS/effect](https://github.com/Effect-TS/effect)");
    expect(md).toContain("`~/kimi-toolchain`");
    expect(md).toContain("upstream / effect");
    expect(md).toContain(
      "| `kimi-toolchain` | kimi-toolchain | [brendadeeznuts1111/kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain) | `~/kimi-toolchain` | tool |"
    );
  });

  test("formatCanonicalReferencesMarkdown full output matches snapshot", () => {
    expect(formatCanonicalReferencesMarkdown(false)).toMatchSnapshot();
  });

  test("formatCanonicalReferencesMarkdown compact output matches snapshot", () => {
    const compact = formatCanonicalReferencesMarkdown(true);
    expect(compact).toMatchSnapshot();
    expect(compact).toContain("Bun, Effect, Kimi Code");
  });

  test("formatCanonicalReferencesInspectPlain full output matches snapshot", () => {
    expect(formatCanonicalReferencesInspectPlain("all")).toMatchSnapshot();
  });

  test("collectEcosystemHttpUrls skips non-http docs paths", () => {
    const urls = collectEcosystemHttpUrls();
    const dxDocs = urls.find((e) => e.ecosystemId === "dx" && e.field === "docs");
    expect(dxDocs).toBeUndefined();
    expect(urls.some((e) => e.ecosystemId === "dx" && e.field === "homepage")).toBe(true);
    expect(urls.some((e) => e.ecosystemId === "bun" && e.field === "docs")).toBe(true);
    expect(isHttpReferenceUrl("~/.config/dx/AGENTS.md")).toBe(false);
  });

  test("checkEcosystemReferenceUrl uses HEAD with GET fallback", async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (init?.method === "HEAD" && url === "https://example.com/head-405") {
        return Promise.resolve(new Response(null, { status: 405 }));
      }
      if (init?.method === "GET" && url === "https://example.com/head-405") {
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      if (url === "https://example.com/fail") {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const prior = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(await checkEcosystemReferenceUrl("https://example.com/ok")).toBe("ok");
      expect(await checkEcosystemReferenceUrl("https://example.com/head-405")).toBe("ok");
      expect(await checkEcosystemReferenceUrl("https://example.com/fail")).toBe("fail");
    } finally {
      globalThis.fetch = prior;
    }
  });

  test("auditEcosystemReferenceUrlsOnline reports skipped dx docs and mocked failures", async () => {
    const fetchMock = mock((url: string) => {
      if (url.includes("moonshotai.github.io")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const issues = await auditEcosystemReferenceUrlsOnline({
      fetchFn: fetchMock as unknown as typeof fetch,
      delayMs: 0,
      timeoutMs: 1000,
    });
    const dxDocs = issues.find((i) => i.ecosystemId === "dx" && i.field === "docs");
    expect(dxDocs?.status).toBe("skipped");
    const mcpHome = issues.find(
      (i) => i.ecosystemId === "cloudflare-mcp" && i.field === "homepage"
    );
    expect(mcpHome?.status).toBe("skipped");
    expect(mcpHome?.message).toContain("mcp RPC");
    const kimiFail = issues.find(
      (i) => i.ecosystemId === "kimi-code" && i.field === "homepage" && i.status === "fail"
    );
    expect(kimiFail).toBeDefined();
    expect(formatEcosystemReferenceUrlReport(issues)).toContain("references-online:");
  });

  test("ECOSYSTEM_BY_ID and LOCAL_DOC_BY_ID provide O(1) typed lookup", () => {
    expect(ECOSYSTEM_BY_ID["bun"].minVersion).toBe("1.4.0");
    expect(ECOSYSTEM_BY_ID["effect"].package).toBe("effect");
    expect(LOCAL_DOC_BY_ID["agents"].repoPath).toBe("AGENTS.md");
    expect(LOCAL_DOC_BY_ID["unified"].cursorCanvas).toContain("kimi-toolchain");
  });

  test("auditCanonicalReferencesHealth passes for aligned repo + runtime", async () => {
    const tmpHome = testTempDir("refs-health-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    const manifest = buildCanonicalReferencesManifest();
    writeText(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(manifest, null, 2)
    );

    const report = await auditCanonicalReferencesHealth(REPO_ROOT, tmpHome);
    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
    expect(report.runtimeSynced).toBe(true);
    expect(report.checks.find((c) => c.name === "repo-fresh")?.status).toBe("ok");
    expect(report.checks.find((c) => c.name === "runtime-aligned")?.status).toBe("ok");

    removePath(tmpHome, { recursive: true, force: true });
  });

  test("auditCanonicalReferencesHealth detects runtime drift", async () => {
    const tmpHome = testTempDir("refs-drift-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    const drifted = { ...buildCanonicalReferencesManifest(), ecosystem: [] };
    writeText(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(drifted, null, 2)
    );

    const report = await auditCanonicalReferencesHealth(REPO_ROOT, tmpHome);
    expect(report.aligned).toBe(false);
    expect(report.runtimeSynced).toBe(false);
    expect(report.checks.find((c) => c.name === "runtime-aligned")?.status).toBe("error");
    expect(report.fixPlan).toContain("bun run sync");

    removePath(tmpHome, { recursive: true, force: true });
  });

  test("referencesContentEqual ignores generatedAt", () => {
    const a = buildCanonicalReferencesManifest();
    const b = { ...a, generatedAt: "1970-01-01T00:00:00.000Z", toolchainVersion: "9.9.9" };
    expect(referencesContentEqual(a, b)).toBe(true);
  });

  test("evaluateProbeHandoffCondition passes for runtime-aligned", async () => {
    const tmpHome = testTempDir("probe-handoff-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    writeText(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(buildCanonicalReferencesManifest(), null, 2)
    );

    const result = await evaluateProbeHandoffCondition(
      "canonical-references:runtime-aligned",
      REPO_ROOT,
      tmpHome
    );
    expect(result.ok).toBe(true);

    removePath(tmpHome, { recursive: true, force: true });
  });

  test("resolveProbeHealthCheck maps runtime-aligned to runtime-cache prerequisite", () => {
    const check = resolveProbeHealthCheck("runtime-aligned", [
      {
        name: "runtime-cache",
        status: "error",
        message: "runtime cache missing at ~/.kimi-code/",
        fixable: true,
      },
    ]);
    expect(check?.name).toBe("runtime-cache");
    expect(check?.status).toBe("error");
  });

  test("resolveProbeHealthCheck maps repo-fresh to repo-manifest prerequisite", () => {
    const check = resolveProbeHealthCheck("repo-fresh", [
      {
        name: "repo-manifest",
        status: "error",
        message: "canonical-references.json missing — run bun run references:generate",
        fixable: true,
      },
    ]);
    expect(check?.name).toBe("repo-manifest");
    expect(check?.status).toBe("error");
  });

  test("resolveProbeHealthCheck passes runtime-cache when only runtime-aligned exists", () => {
    const check = resolveProbeHealthCheck("runtime-cache", [
      {
        name: "runtime-aligned",
        status: "error",
        message: "runtime cache drifted from repo manifest",
        fixable: true,
      },
    ]);
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain("present");
  });

  test("evaluateProbeHandoffCondition surfaces sync fix when runtime cache missing", async () => {
    const tmpHome = testTempDir("probe-missing-cache-");
    makeDir(tmpHome, { recursive: true });

    const result = await evaluateProbeHandoffCondition(
      "canonical-references:runtime-aligned",
      REPO_ROOT,
      tmpHome
    );
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("probe check missing");
    expect(result.message).toContain("runtime cache missing");
    expect(result.message).toContain("bun run sync");

    removePath(tmpHome, { recursive: true, force: true });
  });

  test("evaluateProbeHandoffCondition passes runtime-cache when cache file exists", async () => {
    const tmpHome = testTempDir("probe-cache-exists-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    writeText(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(buildCanonicalReferencesManifest(), null, 2)
    );

    const result = await evaluateProbeHandoffCondition(
      "canonical-references:runtime-cache",
      REPO_ROOT,
      tmpHome
    );
    expect(result.ok).toBe(true);

    removePath(tmpHome, { recursive: true, force: true });
  });

  test("lintManifestBunNative passes for current manifest", () => {
    const violations = lintManifestBunNative(buildCanonicalReferencesManifest());
    expect(violations).toEqual([]);
  });

  test("lintManifestBunNative detects invalid ecosystem URL", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    ecosystem[0] = { ...ecosystem[0]!, homepage: "not-a-url" };
    const violations = lintManifestBunNative({ ...manifest, ecosystem });
    expect(violations.some((v) => v.includes("ecosystem.bun.homepage"))).toBe(true);
  });

  test("lintManifestBunNative allows local ecosystem docs paths", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    const dx = ecosystem.find((ref) => ref.id === "dx");
    expect(dx?.docs).toBe("~/.config/dx/AGENTS.md");
    expect(lintManifestBunNative({ ...manifest, ecosystem })).toEqual([]);
  });

  test("lintManifestBunNative detects invalid repo url shape", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    const idx = repos.findIndex((r) => r.id === "kimi-toolchain");
    repos[idx] = { ...repos[idx]!, url: "http://example.com/foo" };
    const violations = lintManifestBunNative({ ...manifest, repos });
    expect(violations.some((v) => v.includes("repos.kimi-toolchain.url"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid semver", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    ecosystem[0] = { ...ecosystem[0]!, minVersion: "not-semver" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("minVersion"))).toBe(true);
  });

  test("lintManifestBunNative detects schemaVersion mismatch", () => {
    const manifest = buildCanonicalReferencesManifest();
    const violations = lintManifestBunNative({ ...manifest, schemaVersion: 0 as unknown as 1 });
    expect(violations.some((v) => v.includes("schemaVersion"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid kind", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    ecosystem[0] = { ...ecosystem[0]!, kind: "invalid-kind" as never };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes(".kind"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid status", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    ecosystem[0] = { ...ecosystem[0]!, status: "gone" as never };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes(".status"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables rejects noRepo !== true", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    ecosystem[0] = { ...ecosystem[0]!, noRepo: false as never };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes(".noRepo"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects unknown repoId cross-reference", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem];
    const effect = ecosystem.find((e) => e.id === "effect")!;
    ecosystem[ecosystem.indexOf(effect)] = { ...effect, repoId: "nonexistent-repo" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("repoId") && v.includes("nonexistent-repo"))).toBe(
      true
    );
  });

  test("lintCanonicalReferencesLinkTables detects unknown provides ecosystem id", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    repos[0] = { ...repos[0]!, provides: ["nonexistent-eco"] };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes("provides") && v.includes("nonexistent-eco"))).toBe(
      true
    );
  });

  test("lintCanonicalReferencesLinkTables detects runtimePath not starting with ~/", () => {
    const manifest = buildCanonicalReferencesManifest();
    const localDocs = [...manifest.localDocs];
    localDocs[0] = { ...localDocs[0]!, runtimePath: "/absolute/path" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("runtimePath"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid cursorCanvas pattern", () => {
    const manifest = buildCanonicalReferencesManifest();
    const localDocs = [...manifest.localDocs];
    localDocs[0] = { ...localDocs[0]!, cursorCanvas: "wrong/path/foo.tsx" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("cursorCanvas"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid canvasInfluences card id", () => {
    const manifest = buildCanonicalReferencesManifest();
    const localDocs = [...manifest.localDocs];
    localDocs[0] = { ...localDocs[0]!, canvasInfluences: ["not-a-card-id"] };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("canvasInfluences"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects non-integer canvasReadOrder", () => {
    const manifest = buildCanonicalReferencesManifest();
    const localDocs = [...manifest.localDocs];
    localDocs[0] = { ...localDocs[0]!, canvasReadOrder: -1 };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("canvasReadOrder"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables rejects repo url ending in .git", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    const idx = repos.findIndex((r) => r.id === "kimi-toolchain");
    repos[idx] = {
      ...repos[idx]!,
      url: "https://github.com/brendadeeznuts1111/kimi-toolchain.git",
    };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(
      violations.some((v) => v.includes("repos.kimi-toolchain.url") && v.includes(".git"))
    ).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables rejects repo url with trailing slash", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    const idx = repos.findIndex((r) => r.id === "kimi-toolchain");
    repos[idx] = { ...repos[idx]!, url: "https://github.com/brendadeeznuts1111/kimi-toolchain/" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes("repos.kimi-toolchain.url"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects clonePath not starting with ~/", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    repos[0] = { ...repos[0]!, clonePath: "/bad/absolute/path" };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes("clonePath"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid role", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    repos[0] = { ...repos[0]!, role: "maintainer" as never };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes(".role"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid language", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    repos[0] = { ...repos[0]!, language: "cobol" as never };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes(".language"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects invalid framework", () => {
    const manifest = buildCanonicalReferencesManifest();
    const repos = [...manifest.repos];
    repos[0] = { ...repos[0]!, frameworks: ["react" as never] };
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos,
    });
    expect(violations.some((v) => v.includes(".frameworks"))).toBe(true);
  });

  test("lintCanonicalReferencesLinkTables detects duplicate ecosystem ids", () => {
    const manifest = buildCanonicalReferencesManifest();
    const ecosystem = [...manifest.ecosystem, { ...manifest.ecosystem[0]! }];
    const violations = lintCanonicalReferencesLinkTables({
      ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    });
    expect(violations.some((v) => v.includes("duplicate id") && v.includes("ecosystem"))).toBe(
      true
    );
  });

  test("toml round-trip preserves link tables", () => {
    const manifest = buildCanonicalReferencesManifest();
    const source: CanonicalReferencesTomlSource = {
      manifest: { schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION },
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    };
    const text = serializeCanonicalReferencesToml(source);
    const parsed = parseCanonicalReferencesToml(text);
    expect(parsed.ecosystem).toEqual(source.ecosystem);
    expect(parsed.localDocs).toEqual(source.localDocs);
    expect(parsed.repos).toEqual(source.repos);
    expect(generateCanonicalReferencesDataTs(parsed, canonicalDataTypesPrefix()).length).toBeGreaterThan(
      100
    );
  });

  test("generated TS arrays match snapshot", () => {
    const manifest = buildCanonicalReferencesManifest();
    const source: CanonicalReferencesTomlSource = {
      manifest: { schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION },
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    };
    const tsSource = generateCanonicalReferencesDataTs(source, canonicalDataTypesPrefix());
    expect(tsSource).toMatchSnapshot();
  });

  test("generated JSON manifest matches snapshot", async () => {
    const manifest = buildCanonicalReferencesManifest();
    const source: CanonicalReferencesTomlSource = {
      manifest: { schemaVersion: CANONICAL_REFERENCES_SCHEMA_VERSION },
      ecosystem: manifest.ecosystem,
      localDocs: manifest.localDocs,
      repos: manifest.repos,
    };
    const built = buildCanonicalReferencesManifestFromTables(source);
    const jsonOnDisk = await Bun.file(join(REPO_ROOT, "canonical-references.json")).text();
    const existing = JSON.parse(jsonOnDisk) as CanonicalReferencesManifest;
    const finalized = finalizeCanonicalReferencesManifest(built, existing);
    expect(stableStringify(finalized)).toMatchSnapshot();
  });

  test("generation round-trip: TOML → TS + JSON matches disk", async () => {
    const tomlPath = join(REPO_ROOT, "canonical-references.toml");
    const raw = await Bun.file(tomlPath).text();
    const source = parseCanonicalReferencesToml(raw);

    const violations = lintCanonicalReferencesLinkTables({
      ecosystem: source.ecosystem,
      localDocs: source.localDocs,
      repos: source.repos,
    });
    expect(violations).toEqual([]);

    const tsOnDisk = await Bun.file(join(REPO_ROOT, "src/lib/canonical-references-data.ts")).text();
    const tsModule = await import("../src/lib/canonical-references-data.ts");
    expect(tsModule.ECOSYSTEM_REFERENCES).toEqual(source.ecosystem);
    expect(tsModule.LOCAL_DOC_REFERENCES).toEqual(source.localDocs);
    expect(tsModule.REPO_REFERENCES).toEqual(source.repos);
    expect(tsOnDisk).toContain("Auto-generated arrays from canonical-references.toml");

    const jsonOnDisk = await Bun.file(join(REPO_ROOT, "canonical-references.json")).text();
    const existing = JSON.parse(jsonOnDisk) as CanonicalReferencesManifest;
    const generated = buildCanonicalReferencesManifestFromTables(source);
    const finalized = finalizeCanonicalReferencesManifest(generated, existing);
    expect(stableStringify(finalized)).toBe(jsonOnDisk);
  });

  test("lintCanonicalReferencesToml passes for root TOML", async () => {
    const tomlPath = join(REPO_ROOT, "canonical-references.toml");
    const raw = await Bun.file(tomlPath).text();
    expect(lintCanonicalReferencesToml(raw)).toEqual([]);
  });

  test("lintCanonicalReferencesToml detects invalid ecosystem URL", () => {
    const invalid = `
[manifest]
schemaVersion = 1

[[ecosystem]]
id = "bad"
name = "Bad"
kind = "runtime"
homepage = "not-a-url"
docs = "https://example.com"
usage = "Bad URL"

[[localDocs]]
id = "docs"
repoPath = "docs/README.md"
runtimePath = "~/.kimi-code/docs/README.md"
purpose = "Docs"

[[repos]]
id = "kimi-toolchain"
name = "kimi-toolchain"
url = "https://github.com/brendadeeznuts1111/kimi-toolchain"
`;
    const violations = lintCanonicalReferencesToml(invalid);
    expect(violations.some((v) => v.includes("bad.homepage"))).toBe(true);
  });
});
