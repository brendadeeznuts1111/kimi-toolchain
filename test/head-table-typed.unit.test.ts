import { describe, expect, test } from "bun:test";
import { verifyReleaseMeta, type ReleaseMetaDrift } from "../scripts/head-table-typed.ts";
import { BUN_RELEASE, BUN_RELEASE_HISTORY } from "../src/lib/bun-release-registry.ts";

const MATCHING_HASH = BUN_RELEASE.hash;
const MATCHING_VERSION = BUN_RELEASE.version;
const MATCHING_TAG = BUN_RELEASE.tag;

function makeMd(options: { version?: string; hash?: string } = {}): string {
  const version = options.version ?? MATCHING_VERSION;
  const hash = options.hash ?? MATCHING_HASH;
  return `---\ntitle: Bun v${version}\ndate: 2026-01-27\n---\n\n<!-- https://github.com/oven-sh/bun/commit/${hash} -->\n`;
}

function driftField(fields: ReleaseMetaDrift[]): Array<ReleaseMetaDrift["field"]> {
  return fields.map((d) => d.field);
}

describe("head-table-typed verify-release-meta", () => {
  test("returns no drifts when .md matches registry SSOT", () => {
    const drifts = verifyReleaseMeta(makeMd());
    expect(drifts).toHaveLength(0);
  });

  test("detects hash drift", () => {
    const badHash = "a".repeat(40);
    const drifts = verifyReleaseMeta(makeMd({ hash: badHash }));
    expect(driftField(drifts)).toContain("hash");
    const hashDrift = drifts.find((d) => d.field === "hash");
    expect(hashDrift?.expected).toBe(MATCHING_HASH);
    expect(hashDrift?.actual).toBe(badHash);
    expect(hashDrift?.message).toContain("release commit hash mismatch");
  });

  test("detects version drift", () => {
    const drifts = verifyReleaseMeta(makeMd({ version: "1.3.6" }));
    expect(driftField(drifts)).toContain("version");
    const versionDrift = drifts.find((d) => d.field === "version");
    expect(versionDrift?.expected).toBe(MATCHING_VERSION);
    expect(versionDrift?.actual).toBe("v1.3.6");
    expect(versionDrift?.message).toContain("release version mismatch");
  });

  test("detects tag drift derived from .md version", () => {
    const drifts = verifyReleaseMeta(makeMd({ version: "1.3.6" }));
    expect(driftField(drifts)).toContain("tag");
    const tagDrift = drifts.find((d) => d.field === "tag");
    expect(tagDrift?.expected).toBe(MATCHING_TAG);
    expect(tagDrift?.actual).toBe("bun-v1.3.6");
    expect(tagDrift?.message).toContain("release tag mismatch");
  });

  test("returns no drifts when .md lacks parseable version or commit", () => {
    const drifts = verifyReleaseMeta("no frontmatter here");
    expect(drifts).toHaveLength(0);
  });

  test("treats v-prefixed title version as semver-equal to registry", () => {
    const historical = BUN_RELEASE_HISTORY["1.3.6"];
    const md = `---\ntitle: Bun v${historical.version}\ndate: 2026-01-13\n---\n\n<!-- https://github.com/oven-sh/bun/commit/${historical.hash} -->\n`;
    const drifts = verifyReleaseMeta(md, historical);
    expect(drifts).toHaveLength(0);
  });

  test("verifies against historical registry entry when target is passed", () => {
    const historical = BUN_RELEASE_HISTORY["1.3.6"];
    const drifts = verifyReleaseMeta(
      makeMd({ version: historical.version, hash: historical.hash }),
      historical
    );
    expect(drifts).toHaveLength(0);
  });

  test("detects drift against historical target when .md matches current release", () => {
    const historical = BUN_RELEASE_HISTORY["1.3.6"];
    const drifts = verifyReleaseMeta(makeMd(), historical);
    expect(driftField(drifts)).toContain("version");
    expect(driftField(drifts)).toContain("hash");
  });
});
