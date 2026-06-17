import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  auditCanonicalReferencesHealth,
  buildCanonicalReferencesManifest,
  ecosystemReferenceById,
  formatCanonicalReferencesMarkdown,
  isCanonicalReferencesManifest,
  manifestNeedsRefresh,
  referencesContentEqual,
} from "../src/lib/canonical-references.ts";

const REPO_ROOT = import.meta.dir + "/..";

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

  test("formatCanonicalReferencesMarkdown includes key stacks", () => {
    const md = formatCanonicalReferencesMarkdown();
    expect(md).toContain("canonical-references.json");
    expect(md).toContain("https://bun.sh/docs");
    expect(md).toContain("https://effect.website/docs");
    expect(md).toContain("https://herdr.dev/docs/");
    expect(md).toContain("kimi-toolchain");
  });

  test("auditCanonicalReferencesHealth passes for aligned repo + runtime", async () => {
    const tmpHome = join(tmpdir(), `refs-health-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tmpHome, ".kimi-code"), { recursive: true });
    const manifest = buildCanonicalReferencesManifest();
    writeFileSync(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(manifest, null, 2)
    );

    const report = await auditCanonicalReferencesHealth(REPO_ROOT, tmpHome);
    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
    expect(report.runtimeSynced).toBe(true);
    expect(report.checks.find((c) => c.name === "repo-fresh")?.status).toBe("ok");
    expect(report.checks.find((c) => c.name === "runtime-aligned")?.status).toBe("ok");

    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("auditCanonicalReferencesHealth detects runtime drift", async () => {
    const tmpHome = join(tmpdir(), `refs-drift-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tmpHome, ".kimi-code"), { recursive: true });
    const drifted = { ...buildCanonicalReferencesManifest(), ecosystem: [] };
    writeFileSync(
      join(tmpHome, ".kimi-code", "canonical-references.json"),
      JSON.stringify(drifted, null, 2)
    );

    const report = await auditCanonicalReferencesHealth(REPO_ROOT, tmpHome);
    expect(report.aligned).toBe(false);
    expect(report.runtimeSynced).toBe(false);
    expect(report.checks.find((c) => c.name === "runtime-aligned")?.status).toBe("error");
    expect(report.fixPlan).toContain("bun run sync");

    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("referencesContentEqual ignores generatedAt", () => {
    const a = buildCanonicalReferencesManifest();
    const b = { ...a, generatedAt: "1970-01-01T00:00:00.000Z", toolchainVersion: "9.9.9" };
    expect(referencesContentEqual(a, b)).toBe(true);
  });
});
