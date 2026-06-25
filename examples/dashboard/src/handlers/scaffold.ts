// ── Scaffold ───────────────────────────────────────────────────────

import {
  TEMPLATE_POLICY_CHECK_IDS,
  templatePolicyDryRunSummary,
} from "../../../../src/lib/template-policy-audit.ts";
import { jsonResponse } from "./api-handlers.ts";
import { resolveRoot } from "./shared.ts";

export async function apiScaffold(): Promise<Response> {
  const root = resolveRoot();
  const policySummary = await templatePolicyDryRunSummary(root);

  return jsonResponse({
    schemaVersion: 1,
    architecture: {
      scriptGenerator: {
        file: "src/lib/scaffold-modules.ts",
        exports: ["scaffoldKimiModules()", "parseKimiModules()"],
      },
      fileMappings: {
        file: "src/lib/scaffold-templates.ts",
        role: "loadTemplate() provides dx.config.toml, tsconfig.json, CI, etc.",
      },
      policyGate: {
        file: "src/lib/template-policy-audit.ts",
        exports: ["TEMPLATE_POLICY_CHECK_IDS", "auditTemplatePolicy()"],
        cli: "bun run check:template-policy",
      },
      profileRenderer: {
        file: "src/lib/scaffold-profiles.ts",
        role: "renderDxConfig() + scaffoldProfileScripts() for --profile toolchain",
      },
      cli: {
        file: "src/bin/kimi-fix.ts",
        role: "reads --profile and KIMI_MODULES, writes all files",
      },
      greenfieldBridge: {
        file: "src/bin/kimi-new.ts",
        role: "mkdir + bun init -m -y + kimi-fix (avoids scaffold collision)",
      },
      skillCatalog: {
        file: "src/lib/skill-contract.ts",
        cli: "bun run skills:table --verbose",
      },
    },
    bootstrapPaths: [
      {
        id: "bun-create",
        command: "bun create kimi-toolchain my-app",
        note: "postinstall → kimi-fix; no bun init",
      },
      {
        id: "kimi-new",
        command: "kimi-new my-app",
        note: "bun init -m -y bridge before kimi-fix",
      },
      {
        id: "manual",
        command: "mkdir my-app && cd my-app && bun init -m -y && kimi-fix .",
        note: "same bridge without kimi-new wrapper",
      },
    ],
    example: {
      command: "bun create kimi-toolchain my-app",
      output: [
        "package.json with scripts: check, check:fast, typecheck, format, lint, fix, finish-work",
        "src/harness/ — perf monitoring suite when KIMI_MODULES=doctor (default)",
        "src/effect/*/processor.ts — domain effect modules when KIMI_MODULES includes image, trading, …",
        "bunfig.toml — globalStore = true, hardened [install]/[test]",
        "Optional secrets/ registry when herdr-service-template or --with-secrets",
      ],
    },
    templatePolicy: {
      gate: "bun run check:template-policy",
      layers: TEMPLATE_POLICY_CHECK_IDS.length,
      checkIds: [...TEMPLATE_POLICY_CHECK_IDS],
      ssot: "src/lib/template-policy-audit.ts",
      guide: "examples/template-policy-and-scaffold.md",
      showcaseId: "template-policy-and-scaffold",
      summary: policySummary,
    },
    skills: {
      catalog: "bun run skills:table",
      verbose: "bun run skills:table --verbose",
      json: "bun run skills:table --json",
      ssot: "src/lib/skill-contract.ts",
    },
    scripts: {
      perf: "bun run src/bin/perf-doctor.ts --perf-gates --report",
      "perf:gates": "bun run src/bin/perf-doctor.ts --perf-gates",
      "perf:train": "bun run src/bin/perf-doctor.ts --perf-gates --train --out=.",
      "perf:report": "bun run src/bin/perf-doctor.ts --report --open",
    },
    note: "Self-bootstrapping: KIMI_MODULES env var → computeFileMappings → generatePackageJson → write all files. One command to scaffold a complete, gated, self-calibrating Bun project.",
  });
}
