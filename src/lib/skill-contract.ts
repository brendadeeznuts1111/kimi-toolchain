/**
 * Skill ↔ code contract gates — pattern checks, not prose audits.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import type { OrchestratorEventAction } from "./herdr-orchestrator-events.ts";
import { FINISH_WORK_PROBE_IDS } from "./finish-work-herdr.ts";
import { PANE_WHEN_FIELDS } from "./condition-evaluator.ts";
import { EFFECT_GATES } from "./effect-gates.ts";

export interface SkillContractIssue {
  skill: string;
  rule: string;
  message: string;
}

/** Event → action pairs enforced by `routeOrchestratorEvent`. */
export const ORCHESTRATOR_EVENT_ACTIONS: Record<string, OrchestratorEventAction> = {
  "workspace.updated": "context-sync",
  "reviewer.feedback.processed": "context-sync",
  "git.ref.changed": "context-sync",
  "effect.gates.changed": "react",
  "pane.agent_status_changed": "react",
};

const SYNCED_SKILL_ESCAPE_RE = /\]\(\.\.\/\.\.\/[^)]+\)/;

/** Synced skills must not use repo-relative `../../` markdown links. */
export function findSyncedSkillEscapeLinks(skillRel: string, text: string): SkillContractIssue[] {
  if (!skillRel.startsWith("skills/") || !text.includes("../../")) return [];
  const issues: SkillContractIssue[] = [];
  for (const line of text.split("\n")) {
    if (SYNCED_SKILL_ESCAPE_RE.test(line)) {
      issues.push({
        skill: skillRel,
        rule: "synced-skill-escape-link",
        message: "use ~/.kimi-code/ or cwd-qualified paths — not ../../",
      });
    }
  }
  return issues;
}

/** L1+L2 herdr skill must point at L3 and portable references. */
export function auditHerdrSkillContract(skillRel: string, text: string): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [...findSyncedSkillEscapeLinks(skillRel, text)];

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /documentation layers/i,
      rule: "herdr-layer-boundaries",
      message: "missing documentation layers table (L1+L2 vs L3 vs troubleshooting)",
    },
    {
      re: /herdr agent send/,
      rule: "herdr-agent-send",
      message: "must document herdr agent send (orchestrator handoff path)",
    },
    {
      re: /orchestrator/,
      rule: "herdr-orchestrator-pointer",
      message: "must point agents to orchestrator skill for L3 coordination",
    },
    {
      re: /~\/\.kimi-code\/CODE_REFERENCES\.md/,
      rule: "herdr-portable-code-refs",
      message: "CODE_REFERENCES link must use ~/.kimi-code/CODE_REFERENCES.md",
    },
    {
      re: /herdr agent start/,
      rule: "herdr-agent-start-boundary",
      message: "must document agent start vs pane run boundary",
    },
    {
      re: /pane send-text/,
      rule: "herdr-pane-send-boundary",
      message: "must contrast pane send-text with agent send",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  if (
    /### Event → action map/.test(text) ||
    /\|\s*`(?:workspace\.updated|pane\.agent_status_changed|effect\.gates\.changed)`\s*\|\s*`(?:context-sync|react)`\s*\|/.test(
      text
    )
  ) {
    issues.push({
      skill: skillRel,
      rule: "herdr-no-l3-event-table",
      message: "L3 event → action table belongs in orchestrator skill",
    });
  }

  return issues;
}

const EVENT_TABLE_ROW_RE = /\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g;

/** Parse orchestrator skill event table and compare to code routes. */
export function auditOrchestratorEventTable(skillRel: string, text: string): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [];
  const found = new Map<string, string>();

  for (const match of text.matchAll(EVENT_TABLE_ROW_RE)) {
    const event = match[1]?.trim();
    const action = match[2]?.trim();
    if (!event || !action || event === "Event" || action === "Action") continue;
    if (ORCHESTRATOR_EVENT_ACTIONS[event] !== undefined) {
      found.set(event, action);
    }
  }

  for (const [event, expectedAction] of Object.entries(ORCHESTRATOR_EVENT_ACTIONS)) {
    const documented = found.get(event);
    if (!documented) {
      issues.push({
        skill: skillRel,
        rule: "orchestrator-event-missing",
        message: `event table must include \`${event}\``,
      });
    } else if (documented !== expectedAction) {
      issues.push({
        skill: skillRel,
        rule: "orchestrator-event-drift",
        message: `\`${event}\` must map to \`${expectedAction}\`, found \`${documented}\``,
      });
    }
  }

  return issues;
}

/** Minimum probe/when anchors the L3 orchestrator skill must name (full lists live in code). */
export const ORCHESTRATOR_SKILL_PROBE_ANCHORS = ["finish-work:handoff-ready"] as const;
export const ORCHESTRATOR_SKILL_PANE_WHEN_ANCHORS = ["pane.status"] as const;

/** L3 orchestrator skill must mention handoff anchors; code exports hold the full probe/when sets. */
export function auditOrchestratorProbeContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [];

  for (const probeId of ORCHESTRATOR_SKILL_PROBE_ANCHORS) {
    if (!text.includes(probeId)) {
      issues.push({
        skill: skillRel,
        rule: "orchestrator-probe-missing",
        message: `must mention probe id ${probeId}`,
      });
    }
  }

  for (const field of ORCHESTRATOR_SKILL_PANE_WHEN_ANCHORS) {
    if (!text.includes(field)) {
      issues.push({
        skill: skillRel,
        rule: "orchestrator-pane-when-missing",
        message: `must mention when field ${field}`,
      });
    }
  }

  return issues;
}

/** Code-side contract anchors — gate drift without duplicating full lists into skills. */
export function auditCodeProbeWhenExports(): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [];
  if (FINISH_WORK_PROBE_IDS.length < 1) {
    issues.push({
      skill: "code",
      rule: "finish-work-probes-empty",
      message: "FINISH_WORK_PROBE_IDS must not be empty",
    });
  }
  if (PANE_WHEN_FIELDS.size < 1) {
    issues.push({
      skill: "code",
      rule: "pane-when-fields-empty",
      message: "PANE_WHEN_FIELDS must not be empty",
    });
  }
  if (!FINISH_WORK_PROBE_IDS.includes("finish-work:handoff-ready")) {
    issues.push({
      skill: "code",
      rule: "finish-work-handoff-ready-missing",
      message: "FINISH_WORK_PROBE_IDS must include finish-work:handoff-ready",
    });
  }
  if (!PANE_WHEN_FIELDS.has("pane.status")) {
    issues.push({
      skill: "code",
      rule: "pane-status-missing",
      message: "PANE_WHEN_FIELDS must include pane.status",
    });
  }
  return issues;
}

/** Canonical orchestrator skill locations (first existing wins). */
export function resolveOrchestratorSkillPaths(home = Bun.env.HOME || "/tmp"): string[] {
  return [
    join(home, ".grok", "skills", "orchestrator", "SKILL.md"),
    join(home, ".config", "agents", "skills", "orchestrator", "SKILL.md"),
    join(home, "dx-config", "config", "agents", "skills", "orchestrator", "SKILL.md"),
  ];
}

export async function readFirstExisting(
  paths: string[]
): Promise<{ path: string; text: string } | null> {
  for (const path of paths) {
    try {
      const text = await Bun.file(path).text();
      return { path, text };
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function formatSkillContractReport(issues: SkillContractIssue[]): string {
  if (issues.length === 0) return "skill-contract OK";
  const lines = issues.map((i) => `✗ ${i.skill} [${i.rule}] ${i.message}`);
  return `skill-contract: ${issues.length} issue(s)\n${lines.join("\n")}`;
}

/** CLI subcommands implemented in `src/bin/kimi-cloudflare-access.ts`. */
export const CLOUDFLARE_ACCESS_CLI_COMMANDS = [
  "status",
  "dashboard",
  "tokens",
  "apps",
  "doctor",
  "fix",
  "plan",
  "apply",
  "mcp-apply",
  "login",
  "logout",
] as const;

/** Each synced repo skill must map to nearby lib modules and at least one unit test. */
export const REPO_SKILL_CODE_COVERAGE: Record<
  string,
  { libModules: readonly string[]; testFiles: readonly string[] }
> = {
  "skills/herdr/SKILL.md": {
    libModules: ["src/lib/herdr-orchestrator.ts", "src/lib/herdr-orchestrator-events.ts"],
    testFiles: [
      "test/herdr-orchestrator.unit.test.ts",
      "test/herdr-orchestrator-events.unit.test.ts",
    ],
  },
  "skills/kimi-toolchain/SKILL.md": {
    libModules: ["src/lib/tool-runner.ts", "src/bin/kimi-doctor.ts"],
    testFiles: ["test/kimi-toolchain.router.test.ts", "test/governance-check.unit.test.ts"],
  },
  "skills/cloudflare-access/SKILL.md": {
    libModules: ["src/lib/cloudflare-access.ts", "src/lib/cloudflare-access-policy.ts"],
    testFiles: [
      "test/cloudflare-access.unit.test.ts",
      "test/cloudflare-access-policy.unit.test.ts",
    ],
  },
  "skills/effect-discipline/SKILL.md": {
    libModules: [
      "src/lib/effect-gates.ts",
      "src/lib/effect/cli-runtime.ts",
      "src/lib/effect/errors.ts",
    ],
    testFiles: ["test/effect-gates.unit.test.ts", "test/effect/cli-runtime.unit.test.ts"],
  },
};

/** Gate identifier strings from `EFFECT_GATES` — skill must name each id. */
export const EFFECT_GATE_IDENTIFIERS = Object.values(EFFECT_GATES);

function findBarePortableDocLinks(skillRel: string, text: string): SkillContractIssue[] {
  if (!skillRel.startsWith("skills/")) return [];
  const issues: SkillContractIssue[] = [];
  const bare = [
    { re: /\]\(CODE_REFERENCES\.md\)/, label: "CODE_REFERENCES.md" },
    { re: /\]\(AGENTS\.md\)/, label: "AGENTS.md" },
    { re: /\]\(UNIFIED\.md\)/, label: "UNIFIED.md" },
  ];
  for (const { re, label } of bare) {
    if (re.test(text)) {
      issues.push({
        skill: skillRel,
        rule: "synced-skill-bare-doc-link",
        message: `use ~/.kimi-code/${label} in synced skills`,
      });
    }
  }
  return issues;
}

/** Toolchain skill — decision protocols and Kimi vs toolchain boundary. */
export function auditKimiToolchainSkillContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
  ];

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /kimi doctor.*kimi-doctor|kimi-doctor.*kimi doctor/i,
      rule: "kimi-toolchain-doctor-split",
      message: "must distinguish kimi doctor (Moonshot) from kimi-doctor (toolchain)",
    },
    {
      re: /Decision Protocol/i,
      rule: "kimi-toolchain-decision-protocol",
      message: "must include Decision Protocol runbooks",
    },
    {
      re: /bun run check:fast/,
      rule: "kimi-toolchain-check-fast",
      message: "must document bun run check:fast before push",
    },
    {
      re: /kimi-guardian check/,
      rule: "kimi-toolchain-guardian",
      message: "must document kimi-guardian check",
    },
    {
      re: /~\/\.kimi-code\/UNIFIED\.md/,
      rule: "kimi-toolchain-unified-link",
      message: "must link ~/.kimi-code/UNIFIED.md",
    },
    {
      re: /~\/\.kimi-code\/CODE_REFERENCES\.md/,
      rule: "kimi-toolchain-code-refs",
      message: "must link ~/.kimi-code/CODE_REFERENCES.md",
    },
    {
      re: /bun run sync/,
      rule: "kimi-toolchain-sync",
      message: "must document bun run sync for runtime assets",
    },
    {
      re: /effect-discipline/,
      rule: "kimi-toolchain-effect-pointer",
      message: "must point Effect work to effect-discipline skill",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  return issues;
}

/** Cloudflare Access skill — CLI surface, auth separation, plan-before-apply. */
export function auditCloudflareAccessSkillContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
  ];

  for (const cmd of CLOUDFLARE_ACCESS_CLI_COMMANDS) {
    if (!text.includes(`kimi-cloudflare-access ${cmd}`)) {
      issues.push({
        skill: skillRel,
        rule: "cloudflare-cli-missing",
        message: `must document kimi-cloudflare-access ${cmd}`,
      });
    }
  }

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /plan.*before.*apply|run `plan` before every `apply`/i,
      rule: "cloudflare-plan-before-apply",
      message: "must require plan before apply",
    },
    {
      re: /MCP.*Wrangler|Wrangler.*MCP/i,
      rule: "cloudflare-auth-separation",
      message: "must document MCP/Wrangler vs API token auth separation",
    },
    {
      re: /src\/lib\/cloudflare-access\.ts/,
      rule: "cloudflare-code-pointer",
      message: "must point to src/lib/cloudflare-access.ts",
    },
    {
      re: /src\/lib\/cloudflare-access-policy\.ts/,
      rule: "cloudflare-policy-pointer",
      message: "must point to src/lib/cloudflare-access-policy.ts",
    },
    {
      re: /~\/\.kimi-code\/CODE_REFERENCES\.md/,
      rule: "cloudflare-code-refs",
      message: "must link ~/.kimi-code/CODE_REFERENCES.md",
    },
    {
      re: /## Recipes/,
      rule: "cloudflare-recipes",
      message: "must include worked recipes section",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  return issues;
}

/** Effect discipline skill — runCliExit pattern, gate ids, depth doc pointers. */
export function auditEffectDisciplineSkillContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
  ];

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /runCliExit/,
      rule: "effect-run-cli-exit",
      message: "must document runCliExit CLI pattern",
    },
    {
      re: /invokeToolEffect|tool-runner-effect/,
      rule: "effect-tool-boundary",
      message: "must document invokeToolEffect / tool-runner-effect boundary",
    },
    {
      re: /kimi-doctor --effect-gates/,
      rule: "effect-gates-command",
      message: "must document kimi-doctor --effect-gates",
    },
    {
      re: /kimi-heal effect audit/,
      rule: "effect-heal-audit",
      message: "must document kimi-heal effect audit",
    },
    {
      re: /~\/\.kimi-code\/DEEP-QUALITY\.md/,
      rule: "effect-deep-quality-link",
      message: "must link ~/.kimi-code/DEEP-QUALITY.md for depth",
    },
    {
      re: /~\/\.kimi-code\/CODE_REFERENCES\.md/,
      rule: "effect-code-refs-link",
      message: "must link ~/.kimi-code/CODE_REFERENCES.md",
    },
    {
      re: /src\/lib\/effect-gates\.ts/,
      rule: "effect-gates-code-pointer",
      message: "must point to src/lib/effect-gates.ts",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  for (const gateId of EFFECT_GATE_IDENTIFIERS) {
    if (!text.includes(gateId)) {
      issues.push({
        skill: skillRel,
        rule: "effect-gate-id-missing",
        message: `must mention gate id ${gateId}`,
      });
    }
  }

  if (/KIMI_EFFECT_MAX_DIRECT_PROMISE|EffectGatesThresholds/.test(text)) {
    issues.push({
      skill: skillRel,
      rule: "effect-no-threshold-dump",
      message: "threshold tables belong in DEEP-QUALITY.md, not the skill",
    });
  }

  return issues;
}

/** Verify on-disk lib modules and unit tests exist for each repo skill. */
export function auditSkillCodeCoverage(repoRoot: string): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [];

  for (const [skillRel, coverage] of Object.entries(REPO_SKILL_CODE_COVERAGE)) {
    for (const lib of coverage.libModules) {
      const path = join(repoRoot, lib);
      if (!pathExists(path)) {
        issues.push({
          skill: skillRel,
          rule: "skill-code-lib-missing",
          message: `expected lib module ${lib}`,
        });
      }
    }
    const hasTest = coverage.testFiles.some((t) => pathExists(join(repoRoot, t)));
    if (!hasTest) {
      issues.push({
        skill: skillRel,
        rule: "skill-code-test-missing",
        message: `expected at least one unit test among ${coverage.testFiles.join(", ")}`,
      });
    }
  }

  return issues;
}

export function auditRepoSkill(skillRel: string, text: string): SkillContractIssue[] {
  if (skillRel === "skills/herdr/SKILL.md") return auditHerdrSkillContract(skillRel, text);
  if (skillRel === "skills/kimi-toolchain/SKILL.md") {
    return auditKimiToolchainSkillContract(skillRel, text);
  }
  if (skillRel === "skills/cloudflare-access/SKILL.md") {
    return auditCloudflareAccessSkillContract(skillRel, text);
  }
  if (skillRel === "skills/effect-discipline/SKILL.md") {
    return auditEffectDisciplineSkillContract(skillRel, text);
  }
  return findSyncedSkillEscapeLinks(skillRel, text);
}

export interface SkillCoverageRow {
  skill: string;
  lines: number;
  contractOk: boolean;
  contractIssues: SkillContractIssue[];
  libModules: Array<{ path: string; exists: boolean }>;
  testFiles: Array<{ path: string; exists: boolean }>;
  testsOk: boolean;
}

export interface SkillCoverageReport {
  ok: boolean;
  rows: SkillCoverageRow[];
  codeIssues: SkillContractIssue[];
  unmappedSkills: string[];
  orchestrator: {
    path: string;
    contractOk: boolean;
    issues: SkillContractIssue[];
  } | null;
}

/** Full skill ↔ code coverage audit for repo skills + optional installed orchestrator. */
export async function auditSkillCoverage(repoRoot: string): Promise<SkillCoverageReport> {
  const rows: SkillCoverageRow[] = [];
  const unmappedSkills: string[] = [];

  const skillsGlob = new Bun.Glob("*/SKILL.md");
  for await (const rel of skillsGlob.scan({ cwd: join(repoRoot, "skills"), onlyFiles: true })) {
    const skillRel = `skills/${rel}`;
    const text = await Bun.file(join(repoRoot, skillRel)).text();
    const contractIssues = auditRepoSkill(skillRel, text);
    const coverage = REPO_SKILL_CODE_COVERAGE[skillRel];

    if (!coverage) {
      unmappedSkills.push(skillRel);
    }

    const libModules = (coverage?.libModules ?? []).map((path) => ({
      path,
      exists: pathExists(join(repoRoot, path)),
    }));
    const testFiles = (coverage?.testFiles ?? []).map((path) => ({
      path,
      exists: pathExists(join(repoRoot, path)),
    }));

    rows.push({
      skill: skillRel,
      lines: text.split("\n").length,
      contractOk: contractIssues.length === 0,
      contractIssues,
      libModules,
      testFiles,
      testsOk: testFiles.length === 0 || testFiles.some((t) => t.exists),
    });
  }

  rows.sort((a, b) => a.skill.localeCompare(b.skill));

  const codeIssues = auditSkillCodeCoverage(repoRoot);
  const orch = await readFirstExisting(resolveOrchestratorSkillPaths());
  const orchestrator = orch
    ? {
        path: orch.path,
        contractOk:
          auditOrchestratorEventTable(orch.path, orch.text).length === 0 &&
          auditOrchestratorProbeContract(orch.path, orch.text).length === 0,
        issues: [
          ...auditOrchestratorEventTable(orch.path, orch.text),
          ...auditOrchestratorProbeContract(orch.path, orch.text),
        ],
      }
    : null;

  const ok =
    rows.every((r) => r.contractOk && r.testsOk && r.libModules.every((m) => m.exists)) &&
    codeIssues.length === 0 &&
    unmappedSkills.length === 0 &&
    (orchestrator === null || orchestrator.contractOk);

  return { ok, rows, codeIssues, unmappedSkills, orchestrator };
}

export function formatSkillCoverageReport(report: SkillCoverageReport): string {
  const lines: string[] = [];
  lines.push(report.ok ? "lint:skill-coverage OK" : "lint:skill-coverage FAIL");

  for (const row of report.rows) {
    const libOk = row.libModules.filter((m) => m.exists).length;
    const libTotal = row.libModules.length;
    const testOk = row.testFiles.filter((t) => t.exists).length;
    const testTotal = row.testFiles.length;
    const status = row.contractOk && row.testsOk && libOk === libTotal ? "✓" : "✗";
    lines.push(
      `${status} ${row.skill} (${row.lines} lines) contract=${row.contractOk ? "ok" : "fail"} lib=${libOk}/${libTotal} tests=${testOk}/${testTotal}`
    );
    for (const issue of row.contractIssues) {
      lines.push(`    ✗ [${issue.rule}] ${issue.message}`);
    }
  }

  if (report.unmappedSkills.length > 0) {
    lines.push("unmapped skills (add to REPO_SKILL_CODE_COVERAGE):");
    for (const skill of report.unmappedSkills) {
      lines.push(`  ✗ ${skill}`);
    }
  }

  for (const issue of report.codeIssues) {
    lines.push(`✗ ${issue.skill} [${issue.rule}] ${issue.message}`);
  }

  if (report.orchestrator) {
    const o = report.orchestrator;
    lines.push(
      `${o.contractOk ? "✓" : "✗"} orchestrator (${o.path}) contract=${o.contractOk ? "ok" : "fail"}`
    );
    for (const issue of o.issues) {
      lines.push(`    ✗ [${issue.rule}] ${issue.message}`);
    }
  } else {
    lines.push("⚠ orchestrator skill not installed — skipping L3 gate");
  }

  return lines.join("\n");
}
