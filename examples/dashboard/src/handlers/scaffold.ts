// ── Scaffold ───────────────────────────────────────────────────────

import { jsonResponse } from "./api-handlers.ts";

export async function apiScaffold(): Promise<Response> {
  return jsonResponse({
    architecture: {
      scriptGenerator: {
        file: "src/domain/scaffold-plan.ts",
        exports: ["generatePackageScripts()", "generatePackageJson()"],
      },
      fileMappings: {
        file: "src/domain/scaffold-plan.ts",
        role: "computeFileMappings() generates package.json + init.ts",
      },
      cli: { file: "src/bin/kimi-scaffold.ts", role: "reads KIMI_MODULES, writes all files" },
    },
    example: {
      command: "KIMI_MODULES=trace,image,perf bun create kimi my-api",
      output: [
        "package.json with scripts: perf, perf:gates, perf:train, perf:report, perf:watch",
        "src/init.ts with Symbol registrations for each module",
        "src/harness/ — full performance monitoring suite",
        "src/guardian/perf-gate.ts — CI gate logic",
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
