// ── Kimi Doctor / perf-doctor ───────────────────────────────────────

import { jsonResponse } from "./api-handlers.ts";

export async function apiKimiDoctor(): Promise<Response> {
  return jsonResponse({
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
        description: "If all gates pass, update thresholds.json with 10% margin",
        output: "thresholds.json written (skipped benchmarks excluded)",
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
    httpBenchmarks: [
      { key: "http.fetch-h1", protocol: "http1.1", thresholdMs: 50 },
      { key: "http.fetch-h2", protocol: "http2", thresholdMs: 40, note: "skipped when fetch client unavailable" },
      { key: "http.fetch-h3", protocol: "http3", thresholdMs: 35, note: "skipped when Bun.serve http3 unavailable" },
    ],
    allAtOnce: "bun run src/bin/perf-doctor.ts --perf-gates --report --watch --out=.",
    note: "Performance loop lives in perf-doctor (this example). Main kimi-doctor --watch polls effect-gates; use perf-doctor --watch for file-triggered benchmark re-runs.",
  });
}
