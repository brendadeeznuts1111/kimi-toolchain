// ── Scaffold ───────────────────────────────────────────────────────

import { jsonResponse } from "./api-handlers.ts";

export async function apiScaffold(): Promise<Response> {
  return jsonResponse({
    architecture: {
      scriptGenerator: {
        file: "src/lib/scaffold-modules.ts",
        exports: ["scaffoldKimiModules()", "parseKimiModules()"],
      },
      fileMappings: {
        file: "src/lib/scaffold-templates.ts",
        role: "loadTemplate() provides dx.config.toml, tsconfig.json, CI, etc.",
      },
      profileRenderer: {
        file: "src/lib/scaffold-profiles.ts",
        role: "renderDxConfig() + scaffoldProfileScripts() for --profile toolchain",
      },
      cli: {
        file: "src/bin/kimi-fix.ts",
        role: "reads --profile and KIMI_MODULES, writes all files",
      },
    },
    example: {
      command: "KIMI_MODULES=trace,image,perf bun create kimi-toolchain my-app",
      output: [
        "package.json with scripts: check, check:fast, typecheck, format, lint, fix, finish-work",
        "src/init.ts with Symbol registrations for each module",
        "src/harness/ — full performance monitoring suite (doctor module)",
        "src/effect/*/processor.ts — domain effect modules",
        "bunfig.toml — globalStore = true, [doctor.thresholds]",
      ],
    },
    scripts: {
      perf: "bun run src/bin/perf-doctor.ts --perf-gates --report",
      "perf:gates": "bun run src/bin/perf-doctor.ts --perf-gates",
      "perf:train": "bun run src/bin/perf-doctor.ts --perf-gates --train --out=.",
      "perf:report": "bun run src/bin/perf-doctor.ts --report --open",
      "perf:watch": "bun run src/bin/perf-doctor.ts --watch --perf-gates --report",
    },
    note: "Self-bootstrapping: KIMI_MODULES env var → computeFileMappings → generatePackageJson → write all files. One command to scaffold a complete, gated, self-calibrating Bun project.",
  });
}
