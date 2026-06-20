import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  auditMarkdownHeadings,
  auditTemplatesTestFastParity,
  auditTestingDocs,
  inventoryBunTestMentions,
  listMarkdownHeadings,
  TESTING_DOCS_AUDIT_COMMANDS,
} from "../src/lib/testing-docs-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("testing-docs-lint", () => {
  test("encodes manual rg audit commands", () => {
    expect(TESTING_DOCS_AUDIT_COMMANDS.bunTest).toContain("bun test");
    expect(TESTING_DOCS_AUDIT_COMMANDS.foreignRunnersAndTestApi).toContain("vitest");
    expect(TESTING_DOCS_AUDIT_COMMANDS.foreignRunnersAndTestApi).toContain("describe");
    expect(TESTING_DOCS_AUDIT_COMMANDS.headingLowercase).toContain("^#{1,6}");
    expect(TESTING_DOCS_AUDIT_COMMANDS.headingTrailingPunctuation).toContain("[.!?]");
    expect(TESTING_DOCS_AUDIT_COMMANDS.markdownlintOptional).toContain("markdownlint-cli2");
  });

  test("listMarkdownHeadings skips fenced code blocks", () => {
    const text = ["# Title", "```toml", "# not-a-heading", "```", "## Real Section"].join("\n");
    const headings = listMarkdownHeadings(text);
    expect(headings.map((h) => h.title)).toEqual(["Title", "Real Section"]);
  });

  test("auditMarkdownHeadings flags h2 lowercase and trailing punctuation", () => {
    const text = "# kimi-toolchain\n\n## bad section\n\n## Good?\n";
    const issues = auditMarkdownHeadings("sample.md", text);
    expect(issues.some((i) => i.ruleId === "heading-lowercase-start")).toBe(true);
    expect(issues.some((i) => i.ruleId === "heading-trailing-punctuation")).toBe(true);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("TEMPLATES.md test:fast matches scaffold-templates SSOT", async () => {
    const issue = await auditTemplatesTestFastParity(REPO_ROOT);
    expect(issue).toBeUndefined();
  });

  test("repo agent docs pass testing-docs gate", async () => {
    const issues = await auditTestingDocs(REPO_ROOT);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("inventoryBunTestMentions marks debug and anti-pattern lines as allowed", () => {
    const text = [
      "| `bun test <file>` | debug |",
      "| Bare `bun test` in hooks/CI | tier scripts |",
      "Run bun test in pre-commit",
    ].join("\n");
    const hits = inventoryBunTestMentions("AGENTS.md", text);
    expect(hits[0]?.allowed).toBe(true);
    expect(hits[1]?.allowed).toBe(true);
    expect(hits[2]?.allowed).toBe(false);
  });

  test("flags stale run-tests.ts --fast in markdown", async () => {
    const issues = await auditTestingDocs(REPO_ROOT, ["tmp-stale.md"]);
    expect(issues).toEqual([]);
    const local = await auditTestingDocs(REPO_ROOT, []);
    expect(local.some((i) => i.ruleId === "stale-test-fast-script")).toBe(false);
  });
});
