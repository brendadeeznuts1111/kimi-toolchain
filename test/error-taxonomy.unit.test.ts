import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_ROOT, makeDir, removePath, writeText } from "./helpers.ts";
import {
  classifyFailure,
  formatFailureOutput,
  isOpaqueFailureOutput,
  reconstructFailureOutput,
  getSuggestions,
  loadTaxonomy,
  resolveTaxonomyPath,
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

  test("resolveTaxonomyPath prefers repo file under NODE_ENV=test", () => {
    expect(resolveTaxonomyPath()).toBe(join(REPO_ROOT, "error-taxonomy.yml"));
  });

  test("resolveTaxonomyPath honors explicit override", () => {
    expect(resolveTaxonomyPath("/tmp/custom.yml")).toBe("/tmp/custom.yml");
  });

  test("loadTaxonomy falls back to unknown when file missing", async () => {
    const taxonomy = await loadTaxonomy(join(tmpdir(), "missing-taxonomy.yml"));
    expect(taxonomy.categories.length).toBe(1);
    expect(taxonomy.categories[0]?.id).toBe("unknown");
  });

  test("loadTaxonomy parses yaml categories", async () => {
    const dir = join(tmpdir(), `kimi-taxonomy-${Bun.randomUUIDv7()}`);
    makeDir(dir, { recursive: true });
    const path = join(dir, "taxonomy.yml");
    writeText(
      path,
      `version: 2\ncategories:\n  - id: test_cat\n    name: Test Category\n    description: A test category\n    severity: warn\n    expected: false\n    patterns:\n      - regex: "test error"\n`
    );
    const taxonomy = await loadTaxonomy(path);
    expect(taxonomy.version).toBe(2);
    expect(taxonomy.categories[0]?.id).toBe("test_cat");
    removePath(dir, { recursive: true, force: true });
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

  test("classifyFailure matches newly added patterns", async () => {
    const taxonomy = await loadTaxonomy();
    expect(
      classifyFailure("$ bun run scripts/check.ts --fast\nFAIL format:check", taxonomy).category.id
    ).toBe("format_check_failure");
    expect(
      classifyFailure("$ bun run scripts/check.ts --fast\nFAIL lint", taxonomy).category.id
    ).toBe("lint_failure");
    expect(
      classifyFailure("$ bun run scripts/check.ts --fast\nFAIL test:fast", taxonomy).category.id
    ).toBe("test_failure");
    expect(
      classifyFailure("fatal: this operation must be run in a work tree", taxonomy).category.id
    ).toBe("git_not_worktree");
    expect(classifyFailure("Interrupted by user", taxonomy).category.id).toBe("user_interrupt");
    expect(classifyFailure('{"code":"internal","message":"..."}', taxonomy).category.id).toBe(
      "shell_internal_error"
    );
    expect(classifyFailure("Test naming violations:", taxonomy).category.id).toBe(
      "test_naming_violation"
    );
  });

  test("unknownCategory has expected defaults", () => {
    const cat = unknownCategory();
    expect(cat.id).toBe("unknown");
    expect(cat.severity).toBe("info");
  });

  test("formatFailureOutput preserves object error evidence", () => {
    expect(formatFailureOutput({ message: "old_string not found in src/file.ts" })).toBe(
      "old_string not found in src/file.ts"
    );
    expect(formatFailureOutput({ code: "E_FAIL", details: { file: "src/file.ts" } })).toContain(
      '"code": "E_FAIL"'
    );
    expect(formatFailureOutput({ code: "E_FAIL" })).not.toBe("[object Object]");
  });

  test("formatFailureOutput never returns [object Object] for tricky values", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const circularOutput = formatFailureOutput(circular);
    expect(circularOutput).not.toBe("[object Object]");
    expect(circularOutput).toContain("a: 1");
    expect(circularOutput).toContain("self: [Circular]");

    const withBigInt = { id: 123n, name: "test" };
    const bigIntOutput = formatFailureOutput(withBigInt);
    expect(bigIntOutput).not.toBe("[object Object]");
    expect(bigIntOutput).toContain("123");

    const withSymbol = { tag: Symbol("err") };
    expect(formatFailureOutput(withSymbol)).not.toBe("[object Object]");

    const withFunction = { fn: function namedFn() {} };
    expect(formatFailureOutput(withFunction)).not.toBe("[object Object]");

    const withMap = { map: new Map([["k", "v"]]) };
    expect(formatFailureOutput(withMap)).not.toBe("[object Object]");
  });

  test("formatFailureOutput handles Bun-spawn-like errors", () => {
    expect(formatFailureOutput({ exitCode: 7, signal: null })).toBe("exitCode=7");
    expect(formatFailureOutput({ stderr: "ENOENT: no such file", exitCode: 1 })).toBe(
      "ENOENT: no such file"
    );
    expect(formatFailureOutput({ code: "ENOENT", path: "/tmp/missing" })).toContain("ENOENT");
  });

  test("reconstructFailureOutput prefers readable output over opaque placeholder", async () => {
    const taxonomy = await loadTaxonomy();
    expect(isOpaqueFailureOutput("[object Object]")).toBe(true);
    expect(
      reconstructFailureOutput({
        output: "[object Object]",
        context: { stack: "TypeError: boom" },
      })
    ).toBe("TypeError: boom");
    const match = classifyFailure("[object Object]", taxonomy);
    expect(match.category.id).toBe("opaque_hook_output");
  });

  test("classifyFailure matches expected_nonzero with prefixed bash output", async () => {
    const taxonomy = await loadTaxonomy();
    const output = '{"error":"x"}\nCommand failed with exit code: 1.';
    expect(classifyFailure(output, taxonomy).category.id).toBe("expected_nonzero");
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
    expect(results[0]?.categoryId).toBe("max_steps_exceeded");
    expect(results[0]?.autoFix).toBe("bun run check:fast");
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
