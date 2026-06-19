export interface AgentContextEvidence {
  readonly file: string;
  readonly includes: readonly string[];
}

export interface AgentContextCriterion {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly evidence: readonly AgentContextEvidence[];
}

export interface AgentContextCriterionResult extends AgentContextCriterion {
  readonly passed: boolean;
  readonly missing: readonly AgentContextEvidence[];
}

export interface AgentContextQualityReport {
  readonly baselineScore: number;
  readonly targetScore: number;
  readonly score: number;
  readonly scorePct: number;
  readonly improvementPct: number;
  readonly passed: boolean;
  readonly results: readonly AgentContextCriterionResult[];
}

export const AGENT_CONTEXT_BASELINE_SCORE = 80;
export const AGENT_CONTEXT_TARGET_SCORE = Math.ceil(AGENT_CONTEXT_BASELINE_SCORE * 1.15);

export const AGENT_CONTEXT_QUALITY_CRITERIA = [
  {
    id: "reference-first",
    label: "Agents choose local exemplars before editing",
    weight: 8,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["CODE_REFERENCES.md", "pick the closest existing pattern"],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["CODE_REFERENCES.md"],
      },
    ],
  },
  {
    id: "operating-loop",
    label: "Agents follow a compact build loop",
    weight: 8,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["Agent Operating Loop", "Scope", "Guard", "Validate"],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["Agent Operating Loop", "Observe", "Guard", "Validate"],
      },
    ],
  },
  {
    id: "fast-validation",
    label: "Agents use targeted tests and fast gates during iteration",
    weight: 8,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["bun run check:fast", "Target specific test files"],
      },
      {
        file: "src/lib/scaffold-agents.ts",
        includes: ["bun run check:fast", "targeted tests"],
      },
    ],
  },
  {
    id: "regression-hygiene",
    label: "Mistakes become detectors and pattern sweeps",
    weight: 10,
    evidence: [
      {
        file: "AGENTS.md",
        includes: [
          "Regression hygiene",
          "Add a typed detector or gate",
          "Search for the same pattern",
        ],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["Regression Hygiene", "add a detector or gate", "search generated scaffolds"],
      },
    ],
  },
  {
    id: "test-classification",
    label: "Tests declare unit/integration/smoke class and gate membership",
    weight: 8,
    evidence: [
      {
        file: "test/test-gates.unit.test.ts",
        includes: [
          "fast gate includes every unit-named test file",
          "integration gate includes every integration-named test file",
          "all test files declare a unit, integration, or smoke class",
        ],
      },
    ],
  },
  {
    id: "pre-push-fast-default",
    label: "Pre-push fast default is documented and detectable",
    weight: 7,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["pre-push", "check:fast", "KIMI_PRE_PUSH_FULL=1"],
      },
      {
        file: "src/lib/githook-templates.ts",
        includes: ["No refs to push; skipping pre-push checks", "KIMI_PRE_PUSH_FULL"],
      },
    ],
  },
  {
    id: "safe-git-index",
    label: "Agents check the index after rename/index touching commands",
    weight: 5,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["git diff --cached --stat", "git restore --staged"],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["git diff --cached --stat", "git restore --staged"],
      },
    ],
  },
  {
    id: "safe-shell-search",
    label: "Agents quote shell searches safely",
    weight: 5,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["rg -e", "shell metacharacters"],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["rg -e", "shell metacharacters"],
      },
    ],
  },
  {
    id: "introspection-first",
    label: "Agents use introspection surfaces before raw ledgers",
    weight: 8,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["kimi-capabilities --json", "kimi-trace <trace-id> --json"],
      },
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["kimi-capabilities --json", "kimi-trace <trace-id> --json"],
      },
      {
        file: "src/lib/scaffold-agents.ts",
        includes: ["kimi-capabilities --json", "kimi-trace <trace-id> --json"],
      },
    ],
  },
  {
    id: "self-heal-guarded",
    label: "Self-healing stays dry-run first and safeToAutoApply guarded",
    weight: 7,
    evidence: [
      {
        file: "skills/kimi-toolchain/SKILL.md",
        includes: ["kimi-heal apply --dry-run", "safeToAutoApply"],
      },
      {
        file: "src/lib/scaffold-agents.ts",
        includes: ["kimi-heal apply --dry-run", "safeToAutoApply"],
      },
    ],
  },
  {
    id: "contract-trust",
    label: "Contract trust checks are surfaced before trusting declarations",
    weight: 6,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["kimi-contract validate --json", "trusted-keys.json"],
      },
      {
        file: "src/lib/scaffold-agents.ts",
        includes: ["kimi-contract validate --json", "trusted-keys.json"],
      },
    ],
  },
  {
    id: "sync-manifest",
    label: "Runtime sync and manifest verification are explicit",
    weight: 6,
    evidence: [
      {
        file: "AGENTS.md",
        includes: ["bun run sync", "bun run sync:verify"],
      },
      {
        file: "CONTEXT.md",
        includes: ["bun run sync", "bun run sync:verify"],
      },
    ],
  },
  {
    id: "scaffold-quality",
    label: "Generated AGENTS.md carries quality and recovery defaults",
    weight: 8,
    evidence: [
      {
        file: "src/lib/scaffold-agents.ts",
        includes: [
          "Agent Operating Loop",
          "Do not leave root-cause fixes as one-off patches",
          "git diff --cached --stat",
        ],
      },
    ],
  },
  {
    id: "skill-discoverability",
    label: "Skill has UI metadata and a default prompt",
    weight: 6,
    evidence: [
      {
        file: "skills/kimi-toolchain/agents/openai.yaml",
        includes: ["display_name", "short_description", "default_prompt", "$kimi-toolchain"],
      },
    ],
  },
] as const satisfies readonly AgentContextCriterion[];

export function scoreAgentContext(files: Record<string, string>): AgentContextQualityReport {
  const results = AGENT_CONTEXT_QUALITY_CRITERIA.map((criterion) => {
    const missing = criterion.evidence.filter((evidence) => {
      const text = files[evidence.file] ?? "";
      return evidence.includes.some((marker) => !text.includes(marker));
    });
    return {
      ...criterion,
      passed: missing.length === 0,
      missing,
    };
  });

  const max = AGENT_CONTEXT_QUALITY_CRITERIA.reduce((sum, criterion) => sum + criterion.weight, 0);
  const score = results.reduce((sum, result) => sum + (result.passed ? result.weight : 0), 0);
  const scorePct = max === 0 ? 0 : Math.round((score / max) * 100);
  const improvementPct = Math.round(
    ((scorePct - AGENT_CONTEXT_BASELINE_SCORE) / AGENT_CONTEXT_BASELINE_SCORE) * 100
  );

  return {
    baselineScore: AGENT_CONTEXT_BASELINE_SCORE,
    targetScore: AGENT_CONTEXT_TARGET_SCORE,
    score: scorePct,
    scorePct,
    improvementPct,
    passed: scorePct >= AGENT_CONTEXT_TARGET_SCORE,
    results,
  };
}
