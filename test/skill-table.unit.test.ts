import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";
import {
  buildSkillCoverageDetails,
  buildSkillTableRows,
  countFrontmatterList,
  formatSkillTable,
  LOADED_BY_MAX_COLS,
  readFrontmatterScalar,
  SkillCatalog,
  sliceSkillFrontmatter,
  sortSkillTableRows,
  truncateDisplay,
  type SkillTableRow,
} from "../src/lib/skill-table.ts";
import { auditSkillCoverage } from "../src/lib/skill-contract.ts";

function sampleRow(skill: string, layer = "L1"): SkillTableRow {
  return {
    skill,
    layer,
    lines: 100,
    tokens: "400",
    triggers: 2,
    deps: 1,
    loaded_by: "kimi-toolchain",
    contract: "✓",
    lib: "3/3",
    tests: "✓",
  };
}

describe("skill-table", () => {
  test("readFrontmatterScalar and countFrontmatterList parse loader manifest", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/effect-discipline/SKILL.md")).text();
    const head = sliceSkillFrontmatter(text);
    expect(readFrontmatterScalar(head, "layer")).toBe("L1+L2");
    expect(readFrontmatterScalar(head, "token_estimate")).toBe("420");
    expect(countFrontmatterList(head, "trigger")).toBe(4);
    expect(countFrontmatterList(head, "dependencies")).toBe(0);
  });

  test("Bun.stringWidth handles wide Unicode", () => {
    expect(Bun.stringWidth("你好")).toBe(4);
    expect(Bun.stringWidth("🇺🇸")).toBe(2);
  });

  test("truncateDisplay respects display width not char length", () => {
    const wide = "你好世界";
    expect(Bun.stringWidth(wide)).toBe(8);
    const truncated = truncateDisplay(wide, 5);
    expect(Bun.stringWidth(truncated)).toBeLessThanOrEqual(5);
    expect(truncated.endsWith("…")).toBe(true);
  });

  test("truncateDisplay leaves short strings unchanged", () => {
    expect(truncateDisplay("herdr", LOADED_BY_MAX_COLS)).toBe("herdr");
  });

  test("sortSkillTableRows width orders by display width", () => {
    const rows = [sampleRow("你好"), sampleRow("a"), sampleRow("herdr")];
    const sorted = sortSkillTableRows(rows, "width");
    expect(sorted.map((r) => r.skill)).toEqual(["a", "你好", "herdr"]);
  });

  test("sortSkillTableRows layer then name", () => {
    const rows = [
      sampleRow("z-skill", "L2"),
      sampleRow("a-skill", "L1"),
      sampleRow("m-skill", "L1"),
    ];
    const sorted = sortSkillTableRows(rows, "layer");
    expect(sorted.map((r) => `${r.layer}:${r.skill}`)).toEqual([
      "L1:a-skill",
      "L1:m-skill",
      "L2:z-skill",
    ]);
  });

  test("buildSkillTableRows covers every repo skill", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = sortSkillTableRows(await buildSkillTableRows(REPO_ROOT, report.rows), "name");
    expect(rows).toHaveLength(report.rows.length);
    for (const row of rows) {
      expect(row.skill.length).toBeGreaterThan(0);
      expect(row.layer).not.toBe("—");
      expect(row.contract).toBe("✓");
      expect(row.tests).toBe("✓");
    }
  });

  test("formatSkillTable includes headers and skill names", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = sortSkillTableRows(await buildSkillTableRows(REPO_ROOT, report.rows), "name");
    const table = formatSkillTable(rows);
    expect(table).toContain("skill");
    expect(table).toContain("effect-discipline");
    expect(table).toContain("herdr");
  });

  test("buildSkillCoverageDetails maps lib modules per skill", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const details = buildSkillCoverageDetails(report.rows);
    const createTemplate = details.find((d) => d.skill === "create-template");
    expect(createTemplate?.libModules.some((p) => p.includes("template-policy-audit.ts"))).toBe(
      true
    );
    expect(
      createTemplate?.testFiles.some((p) => p.includes("template-policy-audit.unit.test.ts"))
    ).toBe(true);
  });

  test("buildSkillTableRows verbose adds modules column", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = await buildSkillTableRows(REPO_ROOT, report.rows, { verbose: true });
    const createTemplate = rows.find((r) => r.skill === "create-template");
    expect(createTemplate?.modules).toContain("template-policy-audit.ts");
  });

  test("SkillCatalog uses Bun.inspect.custom for table output", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = sortSkillTableRows(await buildSkillTableRows(REPO_ROOT, report.rows), "name");
    const rendered = Bun.inspect(new SkillCatalog(rows));
    expect(rendered).toContain("orchestrator");
    expect(rendered).toContain("layer");
  });
});
