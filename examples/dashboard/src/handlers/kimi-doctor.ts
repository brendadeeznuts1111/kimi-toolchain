// ── Kimi Doctor / perf-doctor ───────────────────────────────────────

import { jsonResponse } from "./api-handlers.ts";

export async function apiKimiDoctor(): Promise<Response> {
  return jsonResponse({
    schemaVersion: 1,
    perfDoctor: {
      cli: "examples/dashboard/src/bin/perf-doctor.ts",
      scaffoldTarget: "src/bin/perf-doctor.ts (KIMI_MODULES=doctor default)",
      commands: [
        {
          flag: "--perf-gates",
          description: "Run benchmarks, validate thresholds",
          output: "pass/fail + process.exit(1) on violation",
        },
        {
          flag: "--report",
          description: "Generate HTML performance report",
          output: "perf-report.html (path via --out)",
        },
        {
          flag: "--train",
          description: "If all gates pass, update layered thresholds with 10% margin",
          output:
            "thresholds.baseline.json (portable) + .kimi/thresholds.local.json (HTTP); skipped benchmarks excluded",
        },
        {
          flag: "--watch",
          description: "Re-run perf gates when harness/isolation sources change",
          output: "node:fs.watch recursive on src/harness + src/lib/isolation",
        },
        {
          flag: "--out",
          description: "Output directory for reports/thresholds (default: cwd)",
          output: "paths relative to --out",
        },
        {
          flag: "--changed-only",
          description: "Scope MODULE_REGISTRY to files changed vs --base",
          output: "default base origin/main; empty key set exits 0",
        },
      ],
      npmScripts: {
        perf: "bun run perf — gates + HTML report",
        "perf:gates:changed": "bun run perf:gates:changed — scoped vs origin/main",
        "perf:train": "bun run perf:train — train thresholds after pass",
        "perf:watch": "bun run perf:watch — file-triggered gates + report",
        "perf:nightly": "bun run perf:nightly — gates + train + report",
      },
      pipeline: "perf-doctor: --perf-gates → --report | --train | --watch",
      allAtOnce: "bun run src/bin/perf-doctor.ts --perf-gates --report --watch --out=.",
    },
    kimiDoctor: {
      cli: "src/bin/kimi-doctor.ts",
      watch: {
        entry: "kimi-doctor --watch",
        mechanism: "Interval poll every 5s — effect-gates only (not perf benchmarks)",
        signals: "SIGINT, SIGTERM",
      },
      gateCommands: [
        "kimi-doctor --gate perf-gate --save-artifact",
        "kimi-doctor --gate bunfig-policy --save-artifact",
        "kimi-doctor --effect-gates --json",
        "kimi-doctor --run-gates --save-artifact",
      ],
      perfFlags: ["--perf-gates", "--train", "--report", "--regression"],
    },
    threeSurfaces: [
      {
        surface: "Doctor gate registry",
        command: "kimi-doctor --gate perf-gate",
        role: "dependsOn closure + optional --save-artifact",
      },
      {
        surface: "Doctor benchmark flags",
        command: "kimi-doctor --perf-gates --train --report",
        role: "Effect benchmark harness on main CLI",
      },
      {
        surface: "Scaffolded perf-doctor",
        command: "bun run perf:gates",
        role: "Per-project harness copied from examples/dashboard/",
      },
    ],
    watchModes: {
      perfDoctor: {
        entry: "bun run perf:watch",
        tool: "perf-doctor.ts",
        mechanism: "node:fs.watch (recursive) on src/harness + src/lib/isolation",
        debounceMs: 300,
        signals: "SIGINT, SIGTERM; SIGHUP/SIGBREAK on Windows",
      },
      kimiDoctor: {
        entry: "kimi-doctor --watch",
        tool: "kimi-doctor (main repo)",
        mechanism: "Interval poll every 5s — effect-gates only (not perf benchmarks)",
        signals: "SIGINT, SIGTERM",
      },
    },
    lineageGates: ["perf-gate", "bunfig-policy", "card-probe"],
    artifactHint:
      "art:0 — run kimi-doctor --gate perf-gate --save-artifact (or --run-gates --save-artifact) to populate identity panel",
    httpBenchmarks: [
      { key: "http.fetch-h1", protocol: "http1.1", thresholdMs: 50 },
      {
        key: "http.fetch-h2",
        protocol: "http2",
        thresholdMs: 40,
        note: "skipped when fetch client unavailable",
      },
      {
        key: "http.fetch-h3",
        protocol: "http3",
        thresholdMs: 35,
        note: "skipped when Bun.serve http3 unavailable",
      },
    ],
    doc: "docs/references/kimi-doctor.md § Effects pipeline",
    note: "Performance loop lives in perf-doctor (this example). Main kimi-doctor --watch polls effect-gates; use perf-doctor --watch for file-triggered benchmark re-runs.",
    // Legacy flat fields for card probes / older clients
    cli: "src/bin/perf-doctor.ts (examples/dashboard performance loop)",
    commands: [
      {
        flag: "--perf-gates",
        description: "Run benchmarks, validate thresholds",
        output: "pass/fail + process.exit(1) on violation",
      },
      {
        flag: "--report",
        description: "Generate HTML performance report",
        output: "perf-report.html (path via --out)",
      },
      {
        flag: "--train",
        description: "If all gates pass, update layered thresholds with 10% margin",
        output:
          "thresholds.baseline.json (portable) + .kimi/thresholds.local.json (HTTP); skipped benchmarks excluded",
      },
      {
        flag: "--watch",
        description: "Re-run perf gates when harness/isolation sources change",
        output: "node:fs.watch recursive on src/harness + src/lib/isolation",
      },
      {
        flag: "--out",
        description: "Output directory for reports/thresholds (default: cwd)",
        output: "paths relative to --out",
      },
    ],
    pipeline: "perf-doctor: --perf-gates → --report | --train | --watch",
    allAtOnce: "bun run src/bin/perf-doctor.ts --perf-gates --report --watch --out=.",
  });
}
