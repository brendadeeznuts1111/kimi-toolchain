import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  classifyFailure,
  getSuggestions,
  loadTaxonomy,
  taxonomyPath,
  unknownCategory,
  buildClassifiedFailure,
  FAILURE_SCHEMA_VERSION,
  type Taxonomy,
} from "../src/lib/error-taxonomy.ts";

describe("error-taxonomy", () => {
  test("taxonomyPath points under ~/.kimi-code", () => {
    expect(taxonomyPath("/tmp/home")).toContain(".kimi-code/error-taxonomy.yml");
  });

  test("loadTaxonomy falls back to unknown when file missing", async () => {
    const taxonomy = await loadTaxonomy(join(tmpdir(), "missing-taxonomy.yml"));
    expect(taxonomy.categories.length).toBe(1);
    expect(taxonomy.categories[0].id).toBe("unknown");
  });

  test("loadTaxonomy parses boundConstants", async () => {
    const dir = join(tmpdir(), `kimi-taxonomy-bound-${Bun.randomUUIDv7()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "taxonomy.yml");
    writeFileSync(
      path,
      `version: 2\ncategories:\n  - id: lint_failure\n    name: Lint\n    description: lint\n    severity: warn\n    expected: false\n    boundConstants:\n      - KIMI_TUNING_SET_VERSION\n    patterns: []\n`
    );
    const taxonomy = await loadTaxonomy(path);
    expect(taxonomy.categories[0].boundConstants).toEqual(["KIMI_TUNING_SET_VERSION"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadTaxonomy back-compat parses relatedConstants", async () => {
    const dir = join(tmpdir(), `kimi-taxonomy-related-${Bun.randomUUIDv7()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "taxonomy.yml");
    writeFileSync(
      path,
      `version: 2\ncategories:\n  - id: lint_failure\n    name: Lint\n    description: lint\n    severity: warn\n    expected: false\n    relatedConstants:\n      - KIMI_TUNING_SET_VERSION\n    patterns: []\n`
    );
    const taxonomy = await loadTaxonomy(path);
    expect(taxonomy.categories[0].boundConstants).toEqual(["KIMI_TUNING_SET_VERSION"]);
    expect(taxonomy.categories[0].relatedConstants).toEqual(["KIMI_TUNING_SET_VERSION"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadTaxonomy parses yaml categories", async () => {
    const dir = join(tmpdir(), `kimi-taxonomy-${Bun.randomUUIDv7()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "taxonomy.yml");
    writeFileSync(
      path,
      `version: 2\ncategories:\n  - id: test_cat\n    name: Test Category\n    description: A test category\n    severity: warn\n    expected: false\n    patterns:\n      - regex: "test error"\n`
    );
    const taxonomy = await loadTaxonomy(path);
    expect(taxonomy.version).toBe(2);
    expect(taxonomy.categories[0].id).toBe("test_cat");
    rmSync(dir, { recursive: true, force: true });
  });

  test("classifyFailure matches known pattern", async () => {
    const taxonomy = await loadTaxonomy(join(import.meta.dir, "..", "error-taxonomy.yml"));
    const match = classifyFailure(
      "old_string not found in foo.ts, the file contents may be out of date. Please use the Read Tool to reload the content.",
      taxonomy
    );
    expect(match.category.id).toBe("edit_stale");
  });

  test("classifyFailure matches missing MCP registration", async () => {
    const taxonomy = await loadTaxonomy(join(import.meta.dir, "..", "error-taxonomy.yml"));
    const match = classifyFailure("MCP config missing unified-shell registration", taxonomy);
    expect(match.category.id).toBe("mcp_config_missing");
    expect(match.category.autoFix).toBe("kimi-doctor --fix");
  });

  test("classifyFailure returns unknown when no match", async () => {
    const taxonomy = await loadTaxonomy();
    const match = classifyFailure("totally unrecognized gibberish xyz123", taxonomy);
    expect(match.category.id).toBe("unknown");
  });

  test("unknownCategory has expected defaults", () => {
    const cat = unknownCategory();
    expect(cat.id).toBe("unknown");
    expect(cat.severity).toBe("info");
  });
});

const sampleTaxonomy: Taxonomy = {
  version: 2,
  categories: [
    {
      id: "max_steps_exceeded",
      name: "Max steps",
      description: "Step limit hit",
      severity: "error",
      expected: false,
      suggestion: "Break work into smaller chunks",
      autoFix: "bun run check:fast",
      patterns: [{ regex: "max steps exceeded" }],
    },
    {
      id: "unknown",
      name: "Unknown",
      description: "No match",
      severity: "info",
      expected: false,
      patterns: [],
    },
  ],
};

describe("error-taxonomy suggestions", () => {
  test("getSuggestions returns suggestion and autoFix", () => {
    const results = getSuggestions("Agent max steps exceeded in turn", sampleTaxonomy);
    expect(results.length).toBe(1);
    expect(results[0].categoryId).toBe("max_steps_exceeded");
    expect(results[0].autoFix).toBe("bun run check:fast");
  });

  test("buildClassifiedFailure sets taxonomyId alias", () => {
    const match = classifyFailure("Agent max steps exceeded in turn", sampleTaxonomy);
    const record = buildClassifiedFailure("Agent", "output", match, {
      context: {
        stack: "Agent stack",
        inputs: { command: "bun run check:fast" },
        environment: { runtime: "bun" },
      },
    });
    expect(record.schemaVersion).toBe(FAILURE_SCHEMA_VERSION);
    expect(record.taxonomyId).toBe("max_steps_exceeded");
    expect(record.categoryId).toBe("max_steps_exceeded");
    expect(record.context?.inputs?.command).toBe("bun run check:fast");
  });
});
