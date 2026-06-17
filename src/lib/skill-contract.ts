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
export function resolveOrchestratorSkillPaths(
  home = Bun.env.HOME || "/tmp",
  repoRoot?: string
): string[] {
  const paths: string[] = [];
  if (repoRoot) {
    paths.push(join(repoRoot, "skills", "orchestrator", "SKILL.md"));
  }
  paths.push(
    join(home, ".grok", "skills", "orchestrator", "SKILL.md"),
    join(home, ".config", "agents", "skills", "orchestrator", "SKILL.md"),
    join(home, "dx-config", "config", "agents", "skills", "orchestrator", "SKILL.md")
  );
  return paths;
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
  "skills/effect-hardening/SKILL.md": {
    libModules: [
      "src/lib/effect-gates.ts",
      "src/lib/effect/decision-services.ts",
      "src/lib/herdr-orchestrator-events.ts",
    ],
    testFiles: ["test/effect-gates.unit.test.ts", "test/herdr-orchestrator-events.unit.test.ts"],
  },
  "skills/orchestrator/SKILL.md": {
    libModules: ["src/lib/herdr-orchestrator.ts", "src/lib/herdr-orchestrator-events.ts"],
    testFiles: [
      "test/herdr-orchestrator.unit.test.ts",
      "test/herdr-orchestrator-events.unit.test.ts",
    ],
  },
  "skills/finish-work/SKILL.md": {
    libModules: ["src/lib/finish-work-herdr.ts", "src/lib/finish-work-config.ts"],
    testFiles: [
      "test/finish-work-herdr.unit.test.ts",
      "test/finish-work-report-schema.unit.test.ts",
    ],
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

/** L3 orchestrator skill — event table, probes, CLI surface. */
export function auditOrchestratorSkillContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  return [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
    ...auditOrchestratorEventTable(skillRel, text),
    ...auditOrchestratorProbeContract(skillRel, text),
    ...(text.includes("herdr-orchestrator status") &&
    text.includes("watch-events") &&
    text.includes("context-sync")
      ? []
      : [
          {
            skill: skillRel,
            rule: "orchestrator-cli-surface",
            message: "must document herdr-orchestrator status, watch-events, context-sync",
          },
        ]),
    ...(text.includes("~/.kimi-code/CODE_REFERENCES.md")
      ? []
      : [
          {
            skill: skillRel,
            rule: "orchestrator-code-refs",
            message: "must link ~/.kimi-code/CODE_REFERENCES.md",
          },
        ]),
  ];
}

/** L3 finish-work skill — pipeline order, Herdr status, orchestrator pointer. */
export function auditFinishWorkSkillContract(skillRel: string, text: string): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
  ];

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /bun run finish-work/,
      rule: "finish-work-command",
      message: "must document bun run finish-work",
    },
    {
      re: /Pipeline order/i,
      rule: "finish-work-pipeline-order",
      message: "must document pipeline order (gates before escalation)",
    },
    {
      re: /emitWorkspaceUpdatedMetadata/,
      rule: "finish-work-metadata-emit",
      message: "must document emitWorkspaceUpdatedMetadata guard",
    },
    {
      re: /workspace\.updated/,
      rule: "finish-work-workspace-updated",
      message: "must mention workspace.updated orchestrator signal",
    },
    {
      re: /needs-review/,
      rule: "finish-work-needs-review",
      message: "must document needs-review escalation status",
    },
    {
      re: /HERDR_ENV/,
      rule: "finish-work-herdr-env",
      message: "must document HERDR_ENV requirement",
    },
    {
      re: /finish-work:handoff-ready/,
      rule: "finish-work-handoff-probe",
      message: "must mention finish-work:handoff-ready probe",
    },
    {
      re: /pane\.status/,
      rule: "finish-work-pane-status",
      message: "must mention pane.status when field",
    },
    {
      re: /report_agent|report-agent/,
      rule: "finish-work-report-agent",
      message: "must document pane.report_agent semantic status",
    },
    {
      re: /orchestrator/,
      rule: "finish-work-orchestrator-pointer",
      message: "must point to orchestrator skill for context-sync",
    },
    {
      re: /src\/lib\/finish-work-herdr\.ts/,
      rule: "finish-work-code-pointer",
      message: "must point to src/lib/finish-work-herdr.ts",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  return issues;
}

/** L3 effect-hardening — modules, templates, gate parity with effect-gates.ts. */
export function auditEffectHardeningSkillContract(
  skillRel: string,
  text: string
): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [
    ...findSyncedSkillEscapeLinks(skillRel, text),
    ...findBarePortableDocLinks(skillRel, text),
  ];

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /Module 1/,
      rule: "effect-hardening-modules",
      message: "must document Module 1–5 hardening modules",
    },
    {
      re: /Data\.TaggedError|Context\.Tag/,
      rule: "effect-hardening-tag-pattern",
      message: "must document Data.TaggedError and Context.Tag patterns",
    },
    {
      re: /kimi-doctor --effect-gates/,
      rule: "effect-hardening-gates-command",
      message: "must document kimi-doctor --effect-gates",
    },
    {
      re: /kimi-heal effect audit/,
      rule: "effect-hardening-heal-audit",
      message: "must document kimi-heal effect audit",
    },
    {
      re: /~\/\.kimi-code\/DEEP-QUALITY\.md/,
      rule: "effect-hardening-deep-quality",
      message: "must link ~/.kimi-code/DEEP-QUALITY.md",
    },
    {
      re: /~\/\.kimi-code\/CODE_REFERENCES\.md/,
      rule: "effect-hardening-code-refs",
      message: "must link ~/.kimi-code/CODE_REFERENCES.md",
    },
    {
      re: /src\/lib\/effect-gates\.ts/,
      rule: "effect-hardening-gates-pointer",
      message: "must point to src/lib/effect-gates.ts",
    },
    {
      re: /templates\//,
      rule: "effect-hardening-templates",
      message: "must reference bundled templates/",
    },
    {
      re: /effect-discipline/,
      rule: "effect-hardening-discipline-pointer",
      message: "must point to effect-discipline for L1+L2",
    },
    {
      re: /does not.*use `@effect\/schema`|NOT.*@effect\/schema/i,
      rule: "effect-hardening-no-effect-schema",
      message: "must state repo does not use @effect/schema",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(text)) issues.push({ skill: skillRel, rule, message });
  }

  for (const gateId of EFFECT_GATE_IDENTIFIERS) {
    if (!text.includes(gateId)) {
      issues.push({
        skill: skillRel,
        rule: "effect-hardening-gate-id-missing",
        message: `must mention gate id ${gateId}`,
      });
    }
  }

  if (
    /@effect\/schema/.test(text) &&
    !/does not.*use `@effect\/schema`|NOT.*@effect\/schema/i.test(text)
  ) {
    issues.push({
      skill: skillRel,
      rule: "effect-hardening-effect-schema-import",
      message: "do not recommend @effect/schema — use safeParse and narrow guards",
    });
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
    {
      re: /effect-hardening/,
      rule: "kimi-toolchain-effect-hardening-pointer",
      message: "must point L3 Effect scaffolds to effect-hardening skill",
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
  const loader = auditSkillLoaderFrontmatter(skillRel, text);
  if (skillRel === "skills/herdr/SKILL.md") {
    return [...loader, ...auditHerdrSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/kimi-toolchain/SKILL.md") {
    return [...loader, ...auditKimiToolchainSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/cloudflare-access/SKILL.md") {
    return [...loader, ...auditCloudflareAccessSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/effect-discipline/SKILL.md") {
    return [...loader, ...auditEffectDisciplineSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/effect-hardening/SKILL.md") {
    return [...loader, ...auditEffectHardeningSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/orchestrator/SKILL.md") {
    return [...loader, ...auditOrchestratorSkillContract(skillRel, text)];
  }
  if (skillRel === "skills/finish-work/SKILL.md") {
    return [...loader, ...auditFinishWorkSkillContract(skillRel, text)];
  }
  return [...loader, ...findSyncedSkillEscapeLinks(skillRel, text)];
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

/** Loader manifest fields — layer, trigger, loaded_by, role, token_estimate. */
export function auditSkillLoaderFrontmatter(skillRel: string, text: string): SkillContractIssue[] {
  const issues: SkillContractIssue[] = [];
  const head = text.slice(0, 1400);
  if (!head.startsWith("---")) return issues;

  const required: Array<{ re: RegExp; rule: string; message: string }> = [
    {
      re: /^layer:/m,
      rule: "skill-layer-missing",
      message: "frontmatter must declare layer:",
    },
    {
      re: /^trigger:/m,
      rule: "skill-trigger-missing",
      message: "frontmatter must declare trigger:",
    },
    {
      re: /^loaded_by:/m,
      rule: "skill-loaded-by-missing",
      message: "frontmatter must declare loaded_by:",
    },
    {
      re: /^role:/m,
      rule: "skill-role-missing",
      message: "frontmatter must declare role:",
    },
    {
      re: /^token_estimate:/m,
      rule: "skill-token-estimate-missing",
      message: "frontmatter must declare token_estimate:",
    },
  ];

  for (const { re, rule, message } of required) {
    if (!re.test(head)) issues.push({ skill: skillRel, rule, message });
  }

  if (/^trigger:/m.test(head) && !/^trigger:\s*\n\s+-\s/m.test(head)) {
    issues.push({
      skill: skillRel,
      rule: "skill-trigger-format",
      message: "trigger must be a YAML list with at least one item",
    });
  }

  if (/^token_estimate:/m.test(head)) {
    const match = head.match(/^token_estimate:\s*(\d+)\s*$/m);
    if (!match || Number(match[1]) < 100) {
      issues.push({
        skill: skillRel,
        rule: "skill-token-estimate-range",
        message: "token_estimate must be a positive integer >= 100",
      });
    }
  }

  return issues;
}

/** Every synced skill must have loadable frontmatter with a name field. */
export async function auditSkillFrontmatter(repoRoot: string): Promise<SkillContractIssue[]> {
  const issues: SkillContractIssue[] = [];
  const skillsGlob = new Bun.Glob("*/SKILL.md");

  for await (const rel of skillsGlob.scan({ cwd: join(repoRoot, "skills"), onlyFiles: true })) {
    const skillRel = `skills/${rel}`;
    let text: string;
    try {
      text = await Bun.file(join(repoRoot, skillRel)).text();
    } catch {
      issues.push({
        skill: skillRel,
        rule: "skill-load-failed",
        message: "SKILL.md is not readable",
      });
      continue;
    }
    if (text.trim().length < 40) {
      issues.push({
        skill: skillRel,
        rule: "skill-empty",
        message: "SKILL.md is too short to be a valid skill",
      });
    }
    const head = text.slice(0, 800);
    if (!head.startsWith("---") || !/\nname:\s/.test(head)) {
      issues.push({
        skill: skillRel,
        rule: "skill-frontmatter-missing",
        message: "SKILL.md must have YAML frontmatter with name:",
      });
    }
  }

  return issues;
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

  const codeIssues = [
    ...auditSkillCodeCoverage(repoRoot),
    ...(await auditSkillFrontmatter(repoRoot)),
  ];
  const repoOrchestratorRel = "skills/orchestrator/SKILL.md";
  const repoOrchestratorPath = join(repoRoot, repoOrchestratorRel);
  const repoOrchestratorOnDisk = pathExists(repoOrchestratorPath);
  const orch = repoOrchestratorOnDisk
    ? { path: repoOrchestratorPath, text: await Bun.file(repoOrchestratorPath).text() }
    : await readFirstExisting(resolveOrchestratorSkillPaths(Bun.env.HOME || "/tmp", repoRoot));

  const orchestratorSkillRel = repoOrchestratorOnDisk ? repoOrchestratorRel : (orch?.path ?? "");
  const orchestratorIssues = orch
    ? auditOrchestratorSkillContract(orchestratorSkillRel, orch.text)
    : [];
  const orchestrator = orch
    ? {
        path: orch.path,
        contractOk: orchestratorIssues.length === 0,
        issues: orchestratorIssues,
      }
    : null;

  const ok =
    rows.every((r) => r.contractOk && r.testsOk && r.libModules.every((m) => m.exists)) &&
    codeIssues.length === 0 &&
    unmappedSkills.length === 0 &&
    orchestrator !== null &&
    orchestrator.contractOk;

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
    lines.push("✗ orchestrator skill missing — add skills/orchestrator/SKILL.md");
  }

  return lines.join("\n");
}
