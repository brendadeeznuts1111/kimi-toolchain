import { describe, test, expect } from "bun:test";
import { findStructuralIssues, FLAG_CATEGORIES } from "../src/completions/flag-taxonomy";
import { loadTaxonomyFromSource, validateTaxonomy } from "../src/completions/taxonomy-validator";

const TAXONOMY_PATH = `${import.meta.dir}/../src/completions/flag-taxonomy.ts`;

describe("completion-taxonomy", () => {
  test("FLAG_CATEGORIES contains expected buckets", () => {
    expect(Object.keys(FLAG_CATEGORIES).sort()).toEqual([
      "debug",
      "fileIO",
      "network",
      "pm",
      "runtime",
    ]);
  });

  test("findStructuralIssues returns empty for current taxonomy", () => {
    const issues = findStructuralIssues();
    expect(issues).toEqual([]);
  });

  test("loadTaxonomyFromSource loads transpiled module via Bun.Transpiler", async () => {
    const mod = await loadTaxonomyFromSource(TAXONOMY_PATH);
    expect(mod.FLAG_CATEGORIES).toBeDefined();
    expect(Object.keys(mod.FLAG_CATEGORIES).sort()).toEqual([
      "debug",
      "fileIO",
      "network",
      "pm",
      "runtime",
    ]);
    expect(mod.FLAG_CATEGORIES.fileIO.has("outfile")).toBe(true);
    expect(mod.FLAG_CATEGORIES.pm.has("frozen-lockfile")).toBe(true);
  });

  test("validateTaxonomy passes for current source", async () => {
    const result = await validateTaxonomy(TAXONOMY_PATH);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toEqual([]);
    expect(result.message).toContain("Taxonomy valid");
  });
});
