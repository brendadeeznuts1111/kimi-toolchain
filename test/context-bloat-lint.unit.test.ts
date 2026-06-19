import { describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  AGENTS_MAX_LINES,
  CONTEXT_MAX_LINES,
  MOVED_DOC_PATHS,
  auditMarkdownFile,
  auditMarkdownText,
  findBareRepoPathRefs,
  findBinCountDrift,
  findBrokenInternalLinks,
  findContextPlaceholders,
  findDuplicatePlaceholders,
  findOrphanAgentDocs,
  findOversizedAgentDocs,
  findPackageBinDrift,
  findStaleDocPathRefs,
  formatContextBloatReport,
  isAgentFacingDoc,
  isDocReferencedFromIndex,
  shouldCheckBareRepoPaths,
} from "../src/lib/context-bloat-lint.ts";

describe("context-bloat-lint", () => {
  test("isAgentFacingDoc includes active docs, scaffold templates, excludes archive", () => {
    expect(isAgentFacingDoc("AGENTS.md")).toBe(true);
    expect(isAgentFacingDoc("docs/SCOPE.md")).toBe(true);
    expect(isAgentFacingDoc("templates/scaffold/code-references.md")).toBe(true);
    expect(isAgentFacingDoc("docs/plans/archive/foo.md")).toBe(false);
    expect(isAgentFacingDoc("CHANGELOG.md")).toBe(false);
  });

  test("shouldCheckBareRepoPaths skips scaffold templates", () => {
    expect(shouldCheckBareRepoPaths("templates/scaffold/code-references.md")).toBe(false);
    expect(shouldCheckBareRepoPaths("AGENTS.md")).toBe(true);
  });

  test("findStaleDocPathRefs flags moved plan paths", () => {
    const text = "See docs/dx-homepage-dashboard-plan.md for details.";
    const issues = findStaleDocPathRefs("README.md", text);
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("stale-doc-path");
  });

  test("findBrokenInternalLinks flags missing relative targets", () => {
    const root = testTempDir("ctx-bloat-");
    const issues = findBrokenInternalLinks(root, "docs/a.md", "[x](./missing.md)");
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("broken-internal-link");
  });

  test("findBareRepoPathRefs flags missing src/test/scripts paths", () => {
    const root = testTempDir("ctx-bloat-");
    const issues = findBareRepoPathRefs(root, "AGENTS.md", "See `test/missing-file.ts`");
    expect(issues.length).toBe(1);
    expect(issues[0]?.rule).toBe("bare-path-missing");
  });

  test("findBrokenInternalLinks ignores portable home paths", () => {
    const root = testTempDir("ctx-bloat-");
    const issues = findBrokenInternalLinks(
      root,
      "skills/herdr/SKILL.md",
      "[refs](~/.kimi-code/CODE_REFERENCES.md) and [dx](~/.config/dx/herdr.md)"
    );
    expect(issues).toHaveLength(0);
  });

  test("findBrokenInternalLinks ignores external URLs", () => {
    const root = testTempDir("ctx-bloat-");
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
    const root = testTempDir("ctx-bloat-");
    makeDir(join(root, "docs"), { recursive: true });
    writeText(join(root, "docs", "target.md"), "# ok\n");
    writeText(join(root, "docs", "source.md"), "[t](./target.md)\n");

    const issues = await auditMarkdownFile(root, "docs/source.md");
    expect(issues).toHaveLength(0);
  });

  test("findOversizedAgentDocs warns when AGENTS.md exceeds line budget", () => {
    const text = `${"line\n".repeat(901)}`;
    const issues = findOversizedAgentDocs("AGENTS.md", text);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("oversized-agent-doc");
    expect(issues[0]?.severity).toBe("warn");
  });

  test("findOversizedAgentDocs warns when CONTEXT.md exceeds line budget", () => {
    const text = `${"line\n".repeat(121)}`;
    const issues = findOversizedAgentDocs("CONTEXT.md", text);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("oversized-agent-doc");
  });

  test("isDocReferencedFromIndex matches full path, markdown links, and parent dirs", () => {
    expect(isDocReferencedFromIndex("docs/SCOPE.md", "See docs/SCOPE.md for scope.")).toBe(true);
    expect(isDocReferencedFromIndex("docs/SCOPE.md", "[scope](docs/SCOPE.md)")).toBe(true);
    expect(isDocReferencedFromIndex("docs/adr/ADR-0001.md", "New ADRs live under docs/adr/")).toBe(
      true
    );
    expect(isDocReferencedFromIndex("docs/SCOPE.md", "No links here.")).toBe(false);
  });

  test("findOrphanAgentDocs errors on unlinked docs/ markdown", () => {
    const issues = findOrphanAgentDocs(
      ["docs/SCOPE.md", "docs/plans/archive/old.md", "docs/linked.md"],
      "Read [linked](docs/linked.md)"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toBe("docs/SCOPE.md");
    expect(issues[0]?.rule).toBe("orphan-agent-doc");
    expect(issues[0]?.severity).toBe("error");
  });

  test("findBinCountDrift passes when AGENTS.md claim matches src/bin count", () => {
    const text = "    bin/                    # CLI entry points (3 registered bins)\n";
    expect(findBinCountDrift(text, 3)).toHaveLength(0);
  });

  test("findBinCountDrift errors when claimed bin count drifts", () => {
    const text = "    bin/                    # CLI entry points (5 registered bins)\n";
    const issues = findBinCountDrift(text, 3);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("bin-count-drift");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("Claims 5");
    expect(issues[0]?.message).toContain("has 3");
  });

  test("findBinCountDrift errors when AGENTS.md omits bin count claim", () => {
    const issues = findBinCountDrift("src/\n  bin/\n", 2);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("bin-count-drift");
  });

  test("findPackageBinDrift errors on missing or unregistered bin entries", () => {
    const issues = findPackageBinDrift(
      { "kimi-doctor": "src/bin/kimi-doctor.ts", stale: "src/bin/removed.ts" },
      ["kimi-doctor.ts", "kimi-new.ts"]
    );
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.rule === "package-bin-drift")).toBe(true);
    expect(issues.some((i) => i.message.includes("stale"))).toBe(true);
    expect(issues.some((i) => i.message.includes("kimi-new.ts"))).toBe(true);
  });

  test("findDuplicatePlaceholders errors when same placeholder appears in 2+ docs", () => {
    const placeholder = "[High-level diagram or description of layers/data flow]";
    const issues = findDuplicatePlaceholders([
      { rel: "CONTEXT.md", text: `## Architecture\n\n${placeholder}\n` },
      { rel: "AGENTS.md", text: `## Layout\n\n${placeholder}\n` },
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.every((i) => i.rule === "duplicate-placeholder")).toBe(true);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  test("findDuplicatePlaceholders ignores single-doc placeholder hits", () => {
    const issues = findDuplicatePlaceholders([
      {
        rel: "TEMPLATES.md",
        text: "[High-level diagram or description of layers/data flow]\n",
      },
    ]);
    expect(issues).toHaveLength(0);
  });

  test("isAgentFacingDoc includes skills and root agent docs, skips node_modules", () => {
    expect(isAgentFacingDoc("skills/kimi-fix/SKILL.md")).toBe(true);
    expect(isAgentFacingDoc("UNIFIED.md")).toBe(true);
    expect(isAgentFacingDoc("TEMPLATES.md")).toBe(true);
    expect(isAgentFacingDoc("node_modules/pkg/README.md")).toBe(false);
    expect(isAgentFacingDoc("coverage/lcov-report/index.html")).toBe(false);
  });

  test("findStaleDocPathRefs flags every moved path and multiple occurrences", () => {
    const stalePaths = Object.keys(MOVED_DOC_PATHS);
    for (const stale of stalePaths) {
      const issues = findStaleDocPathRefs("docs/guide.md", `See ${stale} and again ${stale}.`);
      expect(issues.length).toBe(2);
      expect(issues.every((i) => i.rule === "stale-doc-path")).toBe(true);
      expect(issues[0]?.message).toContain(MOVED_DOC_PATHS[stale]!);
    }
  });

  test("findBrokenInternalLinks ignores anchors, mailto, and strips query fragments", () => {
    const root = testTempDir("ctx-bloat-");
    makeDir(join(root, "docs"), { recursive: true });
    writeText(join(root, "docs", "real.md"), "# ok\n");

    const issues = findBrokenInternalLinks(
      root,
      "docs/a.md",
      [
        "[section](#intro)",
        "[mail](mailto:team@example.com)",
        "[ok](./real.md?tab=1#section)",
        "[ext](https://example.com/doc)",
      ].join("\n")
    );
    expect(issues).toHaveLength(0);
  });

  test("findBareRepoPathRefs accepts concrete src/test/scripts extensions", () => {
    const root = testTempDir("ctx-bloat-");
    makeDir(join(root, "src", "lib"), { recursive: true });
    makeDir(join(root, "scripts"), { recursive: true });
    makeDir(join(root, "test"), { recursive: true });
    writeText(join(root, "src", "lib", "a.ts"), "export {};\n");
    writeText(join(root, "scripts", "run.sh"), "#!/bin/sh\n");
    writeText(join(root, "test", "cfg.toml"), "[x]\n");
    writeText(join(root, "test", "data.json"), "{}\n");

    const text = [
      "`src/lib/a.ts`",
      "`scripts/run.sh`",
      "`test/cfg.toml`",
      "`test/data.json`",
      "`test/missing.ts`",
    ].join("\n");
    const issues = findBareRepoPathRefs(root, "AGENTS.md", text);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("bare-path-missing");
    expect(issues[0]?.message).toContain("test/missing.ts");
  });

  test("findBareRepoPathRefs skips templates, directories, and suffix patterns", () => {
    const root = testTempDir("ctx-bloat-");
    const text = [
      "`src/{templates}/foo.ts`",
      "`test/**/*.ts`",
      "`src/foo/`",
      "`test/sample.example.ts`",
      "`scripts/deploy….sh`",
      "`scripts/rollout...sh`",
      "`src/styles.css`",
      "`~/kimi-toolchain/src/lib/foo.ts`",
      "`https://example.com/src/foo.ts`",
    ].join("\n");

    const issues = findBareRepoPathRefs(root, "AGENTS.md", text);
    expect(issues).toHaveLength(0);
  });

  test("findBareRepoPathRefs checks path before colon line suffix", () => {
    const root = testTempDir("ctx-bloat-");
    makeDir(join(root, "src"), { recursive: true });
    writeText(join(root, "src", "real.ts"), "export {};\n");

    const ok = findBareRepoPathRefs(root, "AGENTS.md", "See `src/real.ts:42`");
    const missing = findBareRepoPathRefs(root, "AGENTS.md", "See `src/ghost.ts:99`");
    expect(ok).toHaveLength(0);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain("src/ghost.ts");
  });

  test("findContextPlaceholders only scans CONTEXT.md", () => {
    const filler = "[Auto-generated. Describe what this project does and who uses it.]";
    expect(findContextPlaceholders("AGENTS.md", filler)).toHaveLength(0);
    expect(findContextPlaceholders("CONTEXT.md", filler)).toHaveLength(1);
  });

  test("findContextPlaceholders flags notes placeholder", () => {
    const issues = findContextPlaceholders(
      "CONTEXT.md",
      "## Notes\n\n[Add domain-specific notes for agents working in this repo.]\n"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("CONTEXT Notes placeholder");
  });

  test("findOversizedAgentDocs stays quiet at limits and for other docs", () => {
    const atAgentsLimit = `${"line\n".repeat(AGENTS_MAX_LINES - 1)}line`;
    const atContextLimit = `${"line\n".repeat(CONTEXT_MAX_LINES - 1)}line`;
    expect(findOversizedAgentDocs("AGENTS.md", atAgentsLimit)).toHaveLength(0);
    expect(findOversizedAgentDocs("CONTEXT.md", atContextLimit)).toHaveLength(0);
    expect(findOversizedAgentDocs("README.md", "line\n".repeat(2000))).toHaveLength(0);
  });

  test("isDocReferencedFromIndex matches basename links and backtick paths", () => {
    expect(isDocReferencedFromIndex("docs/SCOPE.md", "[scope](SCOPE.md)")).toBe(true);
    expect(
      isDocReferencedFromIndex("docs/SCOPE.md", "Edit `docs/SCOPE.md` when scope changes.")
    ).toBe(true);
    expect(isDocReferencedFromIndex("docs/SCOPE.md", "Use `SCOPE.md` as the index.")).toBe(true);
  });

  test("findOrphanAgentDocs skips archive and non-docs paths", () => {
    const issues = findOrphanAgentDocs(
      ["README.md", "skills/foo/SKILL.md", "docs/plans/archive/old.md", "docs/orphan.md"],
      "No index links."
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toBe("docs/orphan.md");
  });

  test("findDuplicatePlaceholders flags regex bracket placeholders across docs", () => {
    const placeholder = "[Add your deployment checklist here]";
    const issues = findDuplicatePlaceholders([
      { rel: "docs/a.md", text: `## Deploy\n\n${placeholder}\n` },
      { rel: "docs/b.md", text: `## Ops\n\n${placeholder}\n` },
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.rule === "duplicate-placeholder")).toBe(true);
    expect(issues[0]!.file.localeCompare(issues[1]!.file)).toBeLessThanOrEqual(0);
  });

  test("findDuplicatePlaceholders dedupes known string hits with regex bucket", () => {
    const known = "[Anything else an agent needs to know: conventions, gotchas, tribal knowledge]";
    const issues = findDuplicatePlaceholders([
      { rel: "CONTEXT.md", text: known },
      { rel: "TEMPLATES.md", text: known },
    ]);
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((i) => i.line))).toEqual(new Set([1]));
  });

  test("auditMarkdownText aggregates per-file rules", () => {
    const root = testTempDir("ctx-bloat-");
    const text = [
      "See docs/dx-homepage-dashboard-plan.md",
      "[broken](./nope.md)",
      "`test/missing.ts`",
    ].join("\n");
    const issues = auditMarkdownText(root, "README.md", text);
    const rules = new Set(issues.map((i) => i.rule));
    expect(rules).toEqual(new Set(["stale-doc-path", "broken-internal-link", "bare-path-missing"]));
  });

  test("formatContextBloatReport renders OK and sorted issue lines", () => {
    expect(formatContextBloatReport([])).toBe("lint:context-bloat OK");

    const report = formatContextBloatReport([
      {
        file: "b.md",
        line: 2,
        rule: "orphan-agent-doc",
        message: "orphan",
        severity: "warn",
      },
      {
        file: "a.md",
        line: 1,
        rule: "bare-path-missing",
        message: "missing",
        severity: "error",
      },
    ]);
    expect(report).toContain("context-bloat: 1 error(s), 1 warn(s)");
    expect(report).toContain("✗ a.md:1 [bare-path-missing] missing");
    expect(report).toContain("⚠ b.md:2 [orphan-agent-doc] orphan");
  });
});
