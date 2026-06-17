import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditMarkdownFile,
  findBrokenInternalLinks,
  findContextPlaceholders,
  findStaleDocPathRefs,
  isAgentFacingDoc,
} from "../src/lib/context-bloat-lint.ts";

describe("context-bloat-lint", () => {
  test("isAgentFacingDoc includes active docs, excludes archive", () => {
    expect(isAgentFacingDoc("AGENTS.md")).toBe(true);
    expect(isAgentFacingDoc("docs/SCOPE.md")).toBe(true);
    expect(isAgentFacingDoc("docs/plans/archive/foo.md")).toBe(false);
    expect(isAgentFacingDoc("CHANGELOG.md")).toBe(false);
  });

  test("findStaleDocPathRefs flags moved plan paths", () => {
    const text = "See docs/dx-homepage-dashboard-plan.md for details.";
    const issues = findStaleDocPathRefs("README.md", text);
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("stale-doc-path");
  });

  test("findBrokenInternalLinks flags missing relative targets", () => {
    const root = mkdtempSync(join(tmpdir(), "ctx-bloat-"));
    const issues = findBrokenInternalLinks(root, "docs/a.md", "[x](./missing.md)");
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("broken-internal-link");
  });

  test("findBrokenInternalLinks ignores external URLs", () => {
    const root = mkdtempSync(join(tmpdir(), "ctx-bloat-"));
    const issues = findBrokenInternalLinks(root, "README.md", "[docs](https://example.com/foo)");
    expect(issues).toHaveLength(0);
  });

  test("findContextPlaceholders flags auto-gen filler", () => {
    const issues = findContextPlaceholders(
      "CONTEXT.md",
      "## Domain\n\n[Auto-generated. Describe what this project does and who uses it.]\n"
    );
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("context-placeholder");
  });

  test("auditMarkdownFile passes when link target exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "ctx-bloat-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "target.md"), "# ok\n");
    writeFileSync(join(root, "docs", "source.md"), "[t](./target.md)\n");

    const issues = await auditMarkdownFile(root, "docs/source.md");
    expect(issues).toHaveLength(0);
  });
});
