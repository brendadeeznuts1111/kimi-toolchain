import { describe, expect, test } from "bun:test";
import {
  CANONICAL_REFERENCES_SCHEMA_VERSION,
  ECOSYSTEM_REFERENCES,
  LOCAL_DOC_REFERENCES,
  REPO_REFERENCES,
  buildCanonicalReferencesManifest,
  ecosystemReferenceById,
  formatCanonicalReferencesMarkdown,
  isCanonicalReferencesManifest,
  manifestNeedsRefresh,
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

  test("formatCanonicalReferencesMarkdown includes key stacks", () => {
    const md = formatCanonicalReferencesMarkdown();
    expect(md).toContain("canonical-references.json");
    expect(md).toContain("https://bun.sh/docs");
    expect(md).toContain("https://effect.website/docs");
    expect(md).toContain("https://herdr.dev/docs/");
    expect(md).toContain("kimi-toolchain");
  });
});
