import { describe, test, expect } from "bun:test";
import {
  classifyFlag,
  classifyFlagForCommand,
  findStructuralIssues,
  FLAG_CATEGORIES,
} from "../src/completions/flag-taxonomy";
import { loadTaxonomyFromSource, validateTaxonomy } from "../src/completions/taxonomy-validator";

const TAXONOMY_PATH = `${import.meta.dir}/../src/completions/flag-taxonomy.ts`;

const EXPECTED_CATEGORIES = [
  "compile",
  "debug",
  "fileIO",
  "jsx",
  "network",
  "output",
  "pm",
  "profiling",
  "resolution",
  "runtime",
  "test",
  "windows",
];

describe("completion-taxonomy", () => {
  test("FLAG_CATEGORIES contains expected buckets", () => {
    expect(Object.keys(FLAG_CATEGORIES).sort()).toEqual(EXPECTED_CATEGORIES.sort());
  });

  test("findStructuralIssues returns empty for current taxonomy", () => {
    const issues = findStructuralIssues();
    expect(issues).toEqual([]);
  });

  test("loadTaxonomyFromSource loads transpiled module via Bun.Transpiler", async () => {
    const mod = await loadTaxonomyFromSource(TAXONOMY_PATH);
    expect(mod.FLAG_CATEGORIES).toBeDefined();
    expect(Object.keys(mod.FLAG_CATEGORIES).sort()).toEqual(EXPECTED_CATEGORIES.sort());
    expect(mod.FLAG_CATEGORIES.fileIO.has("outfile")).toBe(true);
    expect(mod.FLAG_CATEGORIES.pm.has("frozen-lockfile")).toBe(true);
  });

  test("validateTaxonomy passes for current source", async () => {
    const result = await validateTaxonomy(TAXONOMY_PATH);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toEqual([]);
    expect(result.message).toContain("Taxonomy valid");
  });

  test("classifyFlag returns global categories", () => {
    expect(classifyFlag("outfile")).toContain("fileIO");
    expect(classifyFlag("frozen-lockfile")).toContain("pm");
    expect(classifyFlag("totally-unknown-flag")).toEqual(["uncategorized"]);
  });

  test("classifyFlagForCommand applies command-specific overrides", () => {
    // --production is pm globally, but compile under build.
    expect(classifyFlag("production")).toContain("pm");
    expect(classifyFlagForCommand("production", "build")).toEqual(["compile"]);
    expect(classifyFlagForCommand("production", "install")).toContain("pm");

    // --analyze is pm under install/add.
    expect(classifyFlag("analyze")).toContain("pm");
    expect(classifyFlagForCommand("analyze", "install")).toEqual(["pm"]);
    expect(classifyFlagForCommand("analyze", "build")).toContain("pm");
  });
});
