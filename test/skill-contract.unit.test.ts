import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";
import {
  auditCloudflareAccessSkillContract,
  auditCodeProbeWhenExports,
  auditEffectDisciplineSkillContract,
  auditEffectHardeningSkillContract,
  auditFinishWorkSkillContract,
  auditHerdrSkillContract,
  auditKimiToolchainSkillContract,
  EFFECT_GATE_IDENTIFIERS,
  auditOrchestratorEventTable,
  auditOrchestratorProbeContract,
  auditOrchestratorSkillContract,
  auditSkillCodeCoverage,
  auditSkillCoverage,
  auditSkillFrontmatter,
  findSyncedSkillEscapeLinks,
  formatSkillContractReport,
  ORCHESTRATOR_EVENT_ACTIONS,
  REPO_SKILL_CODE_COVERAGE,
  readFirstExisting,
  resolveOrchestratorSkillPaths,
} from "../src/lib/skill-contract.ts";
import { routeOrchestratorEvent } from "../src/lib/herdr-orchestrator-events.ts";

describe("skill-contract", () => {
  test("every repo skill declares code coverage map", () => {
    expect(Object.keys(REPO_SKILL_CODE_COVERAGE).sort()).toEqual(
      [
        "skills/cloudflare-access/SKILL.md",
        "skills/effect-discipline/SKILL.md",
        "skills/effect-hardening/SKILL.md",
        "skills/finish-work/SKILL.md",
        "skills/herdr/SKILL.md",
        "skills/kimi-toolchain/SKILL.md",
        "skills/orchestrator/SKILL.md",
      ].sort()
    );
  });

  test("auditSkillCodeCoverage finds lib modules and tests on disk", () => {
    expect(auditSkillCodeCoverage(REPO_ROOT)).toEqual([]);
  });

  test("auditSkillFrontmatter passes for all repo skills", async () => {
    expect(await auditSkillFrontmatter(REPO_ROOT)).toEqual([]);
  });

  test("auditSkillCoverage passes for all repo skills", async () => {
    const report = await auditSkillCoverage(REPO_ROOT);
    expect(report.unmappedSkills).toEqual([]);
    expect(report.codeIssues).toEqual([]);
    for (const row of report.rows) {
      expect(row.contractOk).toBe(true);
      expect(row.testsOk).toBe(true);
      expect(row.libModules.every((m) => m.exists)).toBe(true);
    }
  });

  test("ORCHESTRATOR_EVENT_ACTIONS matches routeOrchestratorEvent for table events", () => {
    for (const [event, expectedAction] of Object.entries(ORCHESTRATOR_EVENT_ACTIONS)) {
      const envelope =
        event === "pane.agent_status_changed"
          ? { event: "pane.agent_status_changed", data: {} }
          : event === "reviewer.feedback.processed"
            ? { event: "pane.agent_status_changed", data: { custom_status: event } }
            : { event, data: {} };

      const routed = routeOrchestratorEvent(envelope, null);
      expect(routed?.action).toBe(expectedAction);
    }
  });

  test("findSyncedSkillEscapeLinks flags ../../ markdown targets", () => {
    const issues = findSyncedSkillEscapeLinks(
      "skills/herdr/SKILL.md",
      "[x](../../docs/handoff-rules.md)"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("synced-skill-escape-link");
  });

  test("code exports define finish-work probes and pane when fields", () => {
    expect(auditCodeProbeWhenExports()).toEqual([]);
  });

  test("herdr skill passes L1+L2 contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/herdr/SKILL.md")).text();
    const issues = auditHerdrSkillContract("skills/herdr/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("kimi-toolchain skill passes contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/kimi-toolchain/SKILL.md")).text();
    const issues = auditKimiToolchainSkillContract("skills/kimi-toolchain/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("EFFECT_GATE_IDENTIFIERS matches effect-gates.ts exports", () => {
    expect(EFFECT_GATE_IDENTIFIERS).toEqual([
      "direct-promise",
      "layer-circularity",
      "missing-service-tag",
      "domain-purity",
      "run-promise-boundary",
      "event-stream",
    ]);
  });

  test("effect-discipline skill passes contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/effect-discipline/SKILL.md")).text();
    const issues = auditEffectDisciplineSkillContract("skills/effect-discipline/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("effect-hardening skill passes contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/effect-hardening/SKILL.md")).text();
    const issues = auditEffectHardeningSkillContract("skills/effect-hardening/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("cloudflare-access skill passes contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/cloudflare-access/SKILL.md")).text();
    const issues = auditCloudflareAccessSkillContract("skills/cloudflare-access/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("orchestrator skill passes L3 contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/orchestrator/SKILL.md")).text();
    const issues = auditOrchestratorSkillContract("skills/orchestrator/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("finish-work skill passes L3 contract gates", async () => {
    const text = await Bun.file(join(REPO_ROOT, "skills/finish-work/SKILL.md")).text();
    const issues = auditFinishWorkSkillContract("skills/finish-work/SKILL.md", text);
    expect(formatSkillContractReport(issues)).toBe("skill-contract OK");
  });

  test("resolveOrchestratorSkillPaths prefers in-repo skill", () => {
    const paths = resolveOrchestratorSkillPaths("/tmp", REPO_ROOT);
    expect(paths[0]).toBe(join(REPO_ROOT, "skills", "orchestrator", "SKILL.md"));
  });

  test("orchestrator skill event table matches code when installed copy exists", async () => {
    const found = await readFirstExisting(resolveOrchestratorSkillPaths(Bun.env.HOME, REPO_ROOT));
    expect(found).not.toBeNull();

    const eventIssues = auditOrchestratorEventTable(found!.path, found!.text);
    expect(eventIssues).toEqual([]);

    const probeIssues = auditOrchestratorProbeContract(found!.path, found!.text);
    expect(probeIssues).toEqual([]);
  });
});
