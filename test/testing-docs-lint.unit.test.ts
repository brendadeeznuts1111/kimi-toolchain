import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  auditTemplatesTestFastParity,
  auditTestingDocs,
  inventoryBunTestMentions,
  TESTING_DOCS_AUDIT_COMMANDS,
} from "../src/lib/testing-docs-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("testing-docs-lint", () => {
  test("encodes manual rg audit commands", () => {
    expect(TESTING_DOCS_AUDIT_COMMANDS.bunTest).toContain("bun test");
    expect(TESTING_DOCS_AUDIT_COMMANDS.foreignRunnersAndTestApi).toContain("vitest");
    expect(TESTING_DOCS_AUDIT_COMMANDS.foreignRunnersAndTestApi).toContain("describe");
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
