import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  buildSkillPreviewJsonSkills,
  formatSkillPreviewHuman,
  parsePreviewCliArgs,
  resolveSkillPreviews,
} from "../src/lib/skill-preview.ts";
import { REPO_ROOT, testTempDir } from "./helpers.ts";

describe("skill-preview", () => {
  test("parsePreviewCliArgs parses flags and skill name", () => {
    expect(
      parsePreviewCliArgs(["herdr", "--all", "--json", "--no-color", "--columns", "72"])
    ).toEqual({
      skillName: "herdr",
      all: true,
      json: true,
      noColor: true,
      columns: 72,
    });
  });

  test("parsePreviewCliArgs rejects unknown flags", () => {
    expect(parsePreviewCliArgs(["--nope"])).toEqual({ error: "unknown flag: --nope" });
  });

  test("resolveSkillPreviews lists repo skills by default", async () => {
    const targets = await resolveSkillPreviews({ repoRoot: REPO_ROOT });
    expect(targets.length).toBeGreaterThanOrEqual(7);
    expect(targets.every((target) => target.path.includes("/skills/"))).toBe(true);
    expect(targets.some((target) => target.name === "herdr")).toBe(true);
  });

  test("resolveSkillPreviews filters by skill name", async () => {
    const targets = await resolveSkillPreviews({ repoRoot: REPO_ROOT, skillName: "herdr" });
    expect(targets.length).toBe(1);
    expect(targets[0]?.name).toBe("herdr");
  });

  test("resolveSkillPreviews can include agent skills from a temp home", async () => {
    const home = testTempDir("preview-agents");
    const skillDir = join(home, ".agents", "skills", "demo-skill");
    makeDir(skillDir, { recursive: true });
    writeText(
      join(skillDir, "SKILL.md"),
      `---
name: demo-skill
---
# Demo Agent Skill
`
    );

    const targets = await resolveSkillPreviews({
      repoRoot: REPO_ROOT,
      includeAgents: true,
      skillName: "demo-skill",
      home,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.path).toBe(join(skillDir, "SKILL.md"));
  });

  test("buildSkillPreviewJsonSkills emits plain preview and optional ansi", () => {
    const targets = [
      {
        name: "demo",
        path: "/tmp/demo/SKILL.md",
        lines: 4,
        text: "# Demo\n\n**bold**",
      },
    ];
    const plain = buildSkillPreviewJsonSkills(targets, { colors: false, includeAnsi: false });
    expect(plain[0]?.preview).toContain("Demo");
    expect(plain[0]?.ansi).toBeUndefined();

    const colored = buildSkillPreviewJsonSkills(targets, { colors: true, includeAnsi: true });
    expect(colored[0]?.preview).toContain("Demo");
    expect(colored[0]?.ansi).toBeDefined();
  });

  test("formatSkillPreviewHuman includes skill header and body", () => {
    const out = formatSkillPreviewHuman(
      [
        {
          name: "demo",
          path: "/repo/skills/demo/SKILL.md",
          lines: 3,
          text: "# Demo",
        },
      ],
      { colors: false }
    );
    expect(out).toContain("demo (/repo/skills/demo/SKILL.md, 3 lines)");
    expect(out).toContain("Demo");
  });
});
