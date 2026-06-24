import { describe, expect, test } from "bun:test";
import {
  verifyReleaseMetadata,
  type ReleaseMetadataSummary,
} from "../src/lib/bun-release-registry.ts";

function makeMeta(partial: Partial<ReleaseMetadataSummary> = {}): ReleaseMetadataSummary {
  return {
    version: "1.3.6",
    tag: "bun-v1.3.6",
    hash: "d530ed993d62be7c7f8f01a3d52627b6845dfd93",
    featureCommitCount: 16,
    ...partial,
  };
}

describe("validate-release-ssot verify-release-metadata", () => {
  test("returns ok=true when blog and registry agree", () => {
    const result = verifyReleaseMetadata(makeMeta(), makeMeta());
    expect(result.ok).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  test("detects hash drift with column fields", () => {
    const badHash = "0000000000000000000000000000000000000000";
    const blog = makeMeta({ hash: badHash });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(false);
    const drift = result.drifts.find((d) => d.field === "hash");
    expect(drift).toBeDefined();
    expect(drift?.expected).toBe(registry.hash);
    expect(drift?.actual).toBe(badHash);
    expect(drift?.message).toContain("hash mismatch");
  });

  test("detects version drift with column fields", () => {
    const blog = makeMeta({ version: "1.3.7", tag: "bun-v1.3.7" });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(false);
    const drift = result.drifts.find((d) => d.field === "version");
    expect(drift?.expected).toBe("1.3.6");
    expect(drift?.actual).toBe("1.3.7");
    expect(drift?.message).toContain("version mismatch");
  });

  test("detects tag drift with column fields", () => {
    const blog = makeMeta({ tag: "bun-v1.3.7" });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(false);
    const drift = result.drifts.find((d) => d.field === "tag");
    expect(drift?.expected).toBe("bun-v1.3.6");
    expect(drift?.actual).toBe("bun-v1.3.7");
    expect(drift?.message).toContain("tag mismatch");
  });

  test("treats v-prefixed version as semver-equal", () => {
    const blog = makeMeta({ version: "v1.3.6" });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  test("skips hash check when blog hash is missing", () => {
    const blog = makeMeta({ hash: undefined });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  test("detects feature commit count drift with column fields", () => {
    const blog = makeMeta({ featureCommitCount: 15 });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(false);
    const drift = result.drifts.find((d) => d.field === "featureCommitCount");
    expect(drift?.expected).toBe("16");
    expect(drift?.actual).toBe("15");
    expect(drift?.message).toContain("feature commit count mismatch");
  });

  test("skips feature commit count check when blog count is missing", () => {
    const blog = makeMeta({ featureCommitCount: undefined });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(true);
    expect(result.drifts).toHaveLength(0);
  });

  test("reports multiple drifts at once", () => {
    const blog = makeMeta({
      version: "1.3.7",
      tag: "bun-v1.3.7",
      hash: "0000000000000000000000000000000000000000",
      featureCommitCount: 15,
    });
    const registry = makeMeta();
    const result = verifyReleaseMetadata(blog, registry);
    expect(result.ok).toBe(false);
    expect(result.drifts).toHaveLength(4);
  });
});
