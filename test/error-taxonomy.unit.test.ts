import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  classifyFailure,
  loadTaxonomy,
  taxonomyPath,
  unknownCategory,
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
    const taxonomy = await loadTaxonomy();
    const match = classifyFailure(
      "old_string not found in foo.ts, the file contents may be out of date. Please use the Read Tool to reload the content.",
      taxonomy
    );
    expect(match.category.id).toBe("edit_stale");
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
