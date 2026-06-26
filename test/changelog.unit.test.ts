import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { commitsToSection, formatSection, updateChangelog } from "../src/lib/changelog.ts";
import type { Commit } from "../src/lib/conventional-commits.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("changelog", () => {
  describe("commitsToSection", () => {
    test("maps feat commits to Added category", () => {
      const commits: Commit[] = [
        {
          hash: "abc1234",
          subject: "feat(api): add users endpoint",
          body: "",
          type: "feat",
          scope: "api",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.2.0");
      expect(section.added).toHaveLength(1);
      expect(section.added[0]).toContain("add users endpoint");
      expect(section.added[0]).toContain("[abc1234]");
    });

    test("maps fix commits to Fixed category", () => {
      const commits: Commit[] = [
        {
          hash: "def5678",
          subject: "fix: resolve null pointer",
          body: "",
          type: "fix",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.1.1");
      expect(section.fixed).toHaveLength(1);
      expect(section.fixed[0]).toContain("resolve null pointer");
    });

    test("maps breaking changes to breaking category", () => {
      const commits: Commit[] = [
        {
          hash: "ghi9012",
          subject: "feat!: drop legacy support",
          body: "",
          type: "feat",
          scope: "",
          breaking: true,
        },
      ];
      const section = commitsToSection(commits, "2.0.0");
      expect(section.breaking).toHaveLength(1);
      expect(section.breaking[0]).toContain("drop legacy support");
    });

    test("maps docs and refactor to Changed category", () => {
      const commits: Commit[] = [
        {
          hash: "jkl3456",
          subject: "docs: update readme",
          body: "",
          type: "docs",
          scope: "",
          breaking: false,
        },
        {
          hash: "mno7890",
          subject: "refactor: simplify logic",
          body: "",
          type: "refactor",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.3.0");
      expect(section.changed).toHaveLength(2);
    });

    test("maps perf and test to Changed category", () => {
      const commits: Commit[] = [
        {
          hash: "pqr1111",
          subject: "perf: optimize loop",
          body: "",
          type: "perf",
          scope: "",
          breaking: false,
        },
        {
          hash: "stu2222",
          subject: "test: add coverage",
          body: "",
          type: "test",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.3.0");
      expect(section.changed).toHaveLength(2);
    });

    test("maps chore to Changed category", () => {
      const commits: Commit[] = [
        {
          hash: "vwx3333",
          subject: "chore: cleanup files",
          body: "",
          type: "chore",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.3.0");
      expect(section.changed).toHaveLength(1);
    });

    test("maps deps to Security category", () => {
      const commits: Commit[] = [
        {
          hash: "yza4444",
          subject: "deps: update lodash",
          body: "",
          type: "deps",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.3.0");
      expect(section.security).toHaveLength(1);
    });

    test("maps dependency to Security category", () => {
      const commits: Commit[] = [
        {
          hash: "bcd5555",
          subject: "dependency: patch axios",
          body: "",
          type: "dependency",
          scope: "",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.3.0");
      expect(section.security).toHaveLength(1);
    });

    test("includes scope in entry when present", () => {
      const commits: Commit[] = [
        {
          hash: "efg6666",
          subject: "feat(api): add endpoint",
          body: "",
          type: "feat",
          scope: "api",
          breaking: false,
        },
      ];
      const section = commitsToSection(commits, "1.2.0");
      expect(section.added[0]).toContain("**api:**");
    });

    test("sets version and date", () => {
      const commits: Commit[] = [];
      const section = commitsToSection(commits, "2.0.0");
      expect(section.version).toBe("2.0.0");
      expect(section.date).toBe(new Date().toISOString().split("T")[0] ?? "");
    });
  });

  describe("formatSection", () => {
    test("produces valid markdown with version and date", () => {
      const section = {
        version: "1.2.0",
        date: "2024-06-15",
        added: ["**api:** new endpoint ([abc1234])"],
        changed: [],
        fixed: [],
        deprecated: [],
        removed: [],
        security: [],
        breaking: [],
      };
      const markdown = formatSection(section);
      expect(markdown).toContain("## [1.2.0] - 2024-06-15");
      expect(markdown).toContain("### Added");
      expect(markdown).toContain("- **api:** new endpoint ([abc1234])");
    });

    test("includes breaking changes section when present", () => {
      const section = {
        version: "2.0.0",
        date: "2024-06-15",
        added: [],
        changed: [],
        fixed: [],
        deprecated: [],
        removed: [],
        security: [],
        breaking: ["drop legacy support ([def5678])"],
      };
      const markdown = formatSection(section);
      expect(markdown).toContain("### ⚠ BREAKING CHANGES");
      expect(markdown).toContain("- drop legacy support ([def5678])");
    });

    test("skips empty categories", () => {
      const section = {
        version: "1.0.0",
        date: "2024-06-15",
        added: ["initial setup ([abc1234])"],
        changed: [],
        fixed: [],
        deprecated: [],
        removed: [],
        security: [],
        breaking: [],
      };
      const markdown = formatSection(section);
      expect(markdown).toContain("### Added");
      expect(markdown).not.toContain("### Changed");
      expect(markdown).not.toContain("### Fixed");
      expect(markdown).not.toContain("### Security");
    });

    test("includes multiple categories when present", () => {
      const section = {
        version: "1.3.0",
        date: "2024-06-15",
        added: ["feature A"],
        changed: ["refactor B"],
        fixed: ["bug C"],
        deprecated: ["old API"],
        removed: ["legacy code"],
        security: ["patch D"],
        breaking: [],
      };
      const markdown = formatSection(section);
      expect(markdown).toContain("### Added");
      expect(markdown).toContain("### Changed");
      expect(markdown).toContain("### Fixed");
      expect(markdown).toContain("### Deprecated");
      expect(markdown).toContain("### Removed");
      expect(markdown).toContain("### Security");
    });
  });

  describe("updateChangelog", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = artifactPath(REPO_ROOT, "tmp", `changelog-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("inserts section into existing changelog with Unreleased", async () => {
      const initial =
        "# Changelog\n\nAll notable changes...\n\n## [Unreleased]\n\n### Added\n- Initial\n\n## [1.0.0] - 2024-01-01\n";
      writeFileSync(join(tmpDir, "CHANGELOG.md"), initial);

      const section = "## [1.1.0] - 2024-06-15\n\n### Added\n- New feature\n";
      await updateChangelog(tmpDir, section, "1.1.0");

      const content = await Bun.file(join(tmpDir, "CHANGELOG.md")).text();
      expect(content).toContain("## [Unreleased]");
      expect(content.indexOf("## [1.1.0]")).toBeGreaterThan(content.indexOf("## [Unreleased]"));
      expect(content.indexOf("## [1.0.0]")).toBeGreaterThan(content.indexOf("## [1.1.0]"));
    });

    test("creates changelog if missing", async () => {
      const section = "## [1.0.0] - 2024-06-15\n\n### Added\n- Initial release\n";
      await updateChangelog(tmpDir, section, "1.0.0");

      const content = await Bun.file(join(tmpDir, "CHANGELOG.md")).text();
      expect(content).toContain("# Changelog");
      expect(content).toContain("## [1.0.0] - 2024-06-15");
    });

    test("inserts section before first version when no Unreleased", async () => {
      const initial = "# Changelog\n\n## [1.0.0] - 2024-01-01\n\n### Added\n- Initial\n";
      writeFileSync(join(tmpDir, "CHANGELOG.md"), initial);

      const section = "## [1.1.0] - 2024-06-15\n\n### Added\n- New feature\n";
      await updateChangelog(tmpDir, section, "1.1.0");

      const content = await Bun.file(join(tmpDir, "CHANGELOG.md")).text();
      expect(content.indexOf("## [1.1.0]")).toBeLessThan(content.indexOf("## [1.0.0]"));
    });
  });
});
