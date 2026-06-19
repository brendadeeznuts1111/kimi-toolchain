import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  auditCanonicalReferencesHealth,
  evaluateProbeHandoffCondition,
  resolveProbeHealthCheck,
  buildCanonicalReferencesManifest,
  ecosystemReferenceById,
  formatCanonicalReferencesMarkdown,
  isCanonicalReferencesManifest,
  manifestNeedsRefresh,
  referencesContentEqual,
} from "../src/lib/canonical-references.ts";

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
      "shell-spawn-choice",
      "bun-runtime-scaffold",
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

  test("formatCanonicalReferencesMarkdown includes key stacks", () => {
    const md = formatCanonicalReferencesMarkdown();
    expect(md).toContain("canonical-references.json");
    expect(md).toContain("https://bun.sh/docs");
    expect(md).toContain("https://effect.website/docs");
    expect(md).toContain("https://herdr.dev/docs/");
    expect(md).toContain("kimi-toolchain");
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
});
