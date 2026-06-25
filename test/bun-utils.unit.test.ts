import { describe, expect, test } from "bun:test";
import {
  BUN_RELEASE,
  BUN_RELEASE_HISTORY,
  BUN_RELEASE_PREVIOUS,
  buildReleaseHistoryRows,
  measureReleaseHistoryRows,
  releaseFeatureUrl,
  sortReleaseVersions,
} from "../src/lib/bun-utils.ts";

describe("bun-utils", () => {
  test("BUN_RELEASE points to a valid history entry", () => {
    expect(BUN_RELEASE.version in BUN_RELEASE_HISTORY).toBe(true);
    expect(BUN_RELEASE_HISTORY[BUN_RELEASE.version as keyof typeof BUN_RELEASE_HISTORY]).toBe(
      BUN_RELEASE
    );
  });

  test("previous release differs from current", () => {
    expect(BUN_RELEASE_PREVIOUS.version).not.toBe(BUN_RELEASE.version);
    expect(BUN_RELEASE_PREVIOUS.version in BUN_RELEASE_HISTORY).toBe(true);
  });

  test("current release blog URL is a valid bun.com blog link", () => {
    expect(BUN_RELEASE.blogUrl).toMatch(/^https:\/\/bun\.com\/blog\//);
  });

  test("buildReleaseHistoryRows is semver-ordered with role and breaking", () => {
    const rows = buildReleaseHistoryRows();
    expect(rows.map((r) => r.version)).toEqual(
      sortReleaseVersions(Object.keys(BUN_RELEASE_HISTORY))
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({ version: "1.3.5", role: "history", breakingCount: 0 })
    );
    expect(rows.find((r) => r.version === BUN_RELEASE_PREVIOUS.version)).toEqual(
      expect.objectContaining({
        role: "previous",
        breakingCount: BUN_RELEASE_PREVIOUS.breaking.filter((item) => item !== "none").length,
        breaking:
          BUN_RELEASE_PREVIOUS.breaking.filter((item) => item !== "none").length > 0
            ? BUN_RELEASE_PREVIOUS.breaking.join("; ")
            : "—",
      })
    );
    expect(rows.at(-1)).toEqual(
      expect.objectContaining({
        version: BUN_RELEASE.version,
        role: "current",
        breakingCount: 0,
        breaking: "—",
      })
    );
  });

  test("releaseFeatureUrl builds active deep links", () => {
    expect(releaseFeatureUrl("example-anchor")).toBe(`${BUN_RELEASE.blogUrl}#example-anchor`);
  });

  test("measureReleaseHistoryRows reports registry footprint", () => {
    const metrics = measureReleaseHistoryRows(buildReleaseHistoryRows());
    expect(metrics.rowCount).toBe(Object.keys(BUN_RELEASE_HISTORY).length);
    expect(metrics.jsonSerializedLength).toBeGreaterThan(0);
    expect(metrics.currentEqualsPrevious).toBe(false);
  });
});
