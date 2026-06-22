import { describe, expect, test } from "bun:test";
import { shieldIcon, shieldIconDataUri, assets, getAsset } from "../src/lib/embedded-assets.ts";
import { dependencyVersions, versionSummary, versionList } from "../src/lib/dependency-versions.ts";
import {
  installGuide,
  projectOverview,
  readmeHeadings,
  installHelp,
  tableOfContents,
} from "../src/lib/embedded-docs.ts";

// ── Embedded Assets (TypedArray/base64) Tests ────────────────────────

describe("macros > embedded assets (base64)", () => {
  test("shieldIcon is a non-empty base64 string", () => {
    expect(typeof shieldIcon).toBe("string");
    expect(shieldIcon.length).toBeGreaterThan(0);
    // Base64 strings only contain these characters
    expect(shieldIcon).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  test("shieldIcon decodes to valid SVG", () => {
    const decoded = atob(shieldIcon);
    expect(decoded).toContain("<svg");
    expect(decoded).toContain("</svg>");
    expect(decoded).toContain("<path");
  });

  test("shieldIconDataUri has correct format", () => {
    expect(shieldIconDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(shieldIconDataUri).toContain(shieldIcon);
  });

  test("assets registry contains shield", () => {
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("shield");
    expect(assets[0].mimeType).toBe("image/svg+xml");
  });

  test("getAsset finds shield by name", () => {
    const asset = getAsset("shield");
    expect(asset).toBeDefined();
    expect(asset?.base64).toBe(shieldIcon);
  });

  test("getAsset returns undefined for unknown name", () => {
    expect(getAsset("nonexistent")).toBeUndefined();
  });
});

// ── Dependency Versions (async fetch) Tests ──────────────────────────

describe("macros > dependency versions (fetch)", () => {
  test("effect version is a valid semver string", () => {
    expect(dependencyVersions.effect).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("bun version is a valid semver string", () => {
    expect(dependencyVersions.bun).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("typescript version is a valid semver string", () => {
    expect(dependencyVersions.typescript).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("js-yaml version is a valid semver string", () => {
    expect(dependencyVersions["js-yaml"]).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("versionSummary contains all packages", () => {
    expect(versionSummary).toContain("effect@");
    expect(versionSummary).toContain("bun@");
    expect(versionSummary).toContain("typescript@");
    expect(versionSummary).toContain("js-yaml@");
  });

  test("versionList has multi-line format", () => {
    expect(versionList).toContain("effect:");
    expect(versionList).toContain("bun:");
    expect(versionList.split("\n").length).toBe(4);
  });
});

// ── Embedded Docs (HTMLRewriter) Tests ───────────────────────────────

describe("macros > embedded docs (HTMLRewriter)", () => {
  test("installGuide contains install instructions", () => {
    expect(installGuide.length).toBeGreaterThan(50);
    expect(installGuide.toLowerCase()).toContain("install");
  });

  test("installGuide contains bun install command", () => {
    expect(installGuide).toContain("bun install");
  });

  test("projectOverview is a non-empty string", () => {
    expect(typeof projectOverview).toBe("string");
    expect(projectOverview.length).toBeGreaterThan(0);
  });

  test("readmeHeadings is a non-empty array", () => {
    expect(Array.isArray(readmeHeadings)).toBe(true);
    expect(readmeHeadings.length).toBeGreaterThan(0);
  });

  test("readmeHeadings contains expected sections", () => {
    expect(readmeHeadings).toContain("Install");
  });

  test("installHelp has formatted header", () => {
    expect(installHelp).toContain("Install Guide:");
    expect(installHelp).toContain(installGuide);
  });

  test("tableOfContents has numbered list format", () => {
    expect(tableOfContents).toContain("Table of Contents:");
    expect(tableOfContents).toMatch(/\d+\./);
  });
});
