import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";
import {
  canRunReferencesInspectMarkdownWatch,
  canRunReferencesInspectPtyWatch,
  formatWatchChildExitMessage,
  parseReferencesInspectWatchKey,
  referencesInspectWatchPaths,
  stripTerminalInput,
} from "../src/lib/references-inspect-watch.ts";
import {
  filterCanonicalReferencesMarkdownSection,
  formatCanonicalReferencesMarkdown,
} from "../src/lib/canonical-references.ts";
import { markdownAnsiSupported } from "../src/lib/bun-markdown.ts";

describe("references-inspect-watch", () => {
  test("parseReferencesInspectWatchKey maps navigation keys", () => {
    expect(parseReferencesInspectWatchKey("q")).toEqual({ action: "quit" });
    expect(parseReferencesInspectWatchKey("r")).toEqual({ action: "refresh" });
    expect(parseReferencesInspectWatchKey("0")).toEqual({ action: "section", section: "all" });
    expect(parseReferencesInspectWatchKey("1")).toEqual({
      action: "section",
      section: "ecosystem",
    });
    expect(parseReferencesInspectWatchKey("2")).toEqual({ action: "section", section: "repos" });
    expect(parseReferencesInspectWatchKey("3")).toEqual({ action: "section", section: "docs" });
    expect(parseReferencesInspectWatchKey("x")).toEqual({ action: "noop" });
  });

  test("stripTerminalInput removes escape sequences", () => {
    expect(stripTerminalInput(`${String.fromCharCode(0x1b)}[Aq`)).toBe("q");
  });

  test("referencesInspectWatchPaths includes TOML SSOT and generated artifacts", () => {
    const paths = referencesInspectWatchPaths(REPO_ROOT);
    expect(paths).toContain(join(REPO_ROOT, "canonical-references.toml"));
    expect(paths).toContain(join(REPO_ROOT, "src/lib/canonical-references-data.ts"));
    expect(paths).toContain(join(REPO_ROOT, "canonical-references.json"));
  });

  test("formatWatchChildExitMessage returns null on success", () => {
    expect(formatWatchChildExitMessage(0, "all")).toBeNull();
    expect(formatWatchChildExitMessage(1, "ecosystem")).toContain("exited 1");
  });

  test("filterCanonicalReferencesMarkdownSection slices ecosystem table only", () => {
    const full = formatCanonicalReferencesMarkdown(false);
    const eco = filterCanonicalReferencesMarkdownSection(full, "ecosystem");
    expect(eco).toContain("### Ecosystem");
    expect(eco).not.toContain("### Repositories");
    expect(eco).toContain("✅ active");
  });

  test("canRunReferencesInspectMarkdownWatch probes Bun.markdown.ansi", () => {
    const probe = canRunReferencesInspectMarkdownWatch();
    if (markdownAnsiSupported() && process.stdout.isTTY && process.stdin.isTTY) {
      expect(probe.ok).toBe(true);
    } else {
      expect(probe.ok).toBe(false);
      expect(probe.reason).toBeDefined();
    }
  });

  test("canRunReferencesInspectPtyWatch reports reason in non-TTY test env", () => {
    const probe = canRunReferencesInspectPtyWatch();
    if (process.stdout.isTTY && process.stdin.isTTY && typeof Bun.Terminal === "function") {
      expect(probe.ok).toBe(true);
    } else {
      expect(probe.ok).toBe(false);
      expect(probe.reason).toBeDefined();
    }
  });
});
