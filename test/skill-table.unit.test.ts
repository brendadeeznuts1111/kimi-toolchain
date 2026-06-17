import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  buildSkillTableRows,
  countFrontmatterList,
  formatSkillTable,
  readFrontmatterScalar,
  SkillCatalog,
  sliceSkillFrontmatter,
} from "../src/lib/skill-table.ts";
import { auditSkillCoverage } from "../src/lib/skill-contract.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("skill-table", () => {
  test("readFrontmatterScalar and countFrontmatterList parse loader manifest", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/effect-discipline/SKILL.md")).text();
    const head = sliceSkillFrontmatter(text);
    expect(readFrontmatterScalar(head, "layer")).toBe("L1+L2");
    expect(readFrontmatterScalar(head, "token_estimate")).toBe("420");
    expect(countFrontmatterList(head, "trigger")).toBe(4);
    expect(countFrontmatterList(head, "dependencies")).toBe(0);
  });

  test("buildSkillTableRows covers every repo skill", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = await buildSkillTableRows(REPO_ROOT, report.rows);
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
    const rows = await buildSkillTableRows(REPO_ROOT, report.rows);
    const table = formatSkillTable(rows);
    expect(table).toContain("skill");
    expect(table).toContain("effect-discipline");
    expect(table).toContain("herdr");
  });

  test("SkillCatalog uses Bun.inspect.custom for table output", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    const rows = await buildSkillTableRows(REPO_ROOT, report.rows);
    const rendered = Bun.inspect(new SkillCatalog(rows));
    expect(rendered).toContain("orchestrator");
    expect(rendered).toContain("layer");
  });
});
