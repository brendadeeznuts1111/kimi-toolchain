#!/usr/bin/env bun
/**
 * Deep native cleanup scanner — 15-tier pattern matrix.
 *
 * Usage:
 *   bun run deep-native:scan
 *   bun run deep-native:scan -- src scripts
 *   bun run deep-native:scan --json
 */

import { Glob } from "bun";

const roots = Bun.argv.slice(2).filter((a) => !a.startsWith("-"));
const jsonOut = Bun.argv.includes("--json");
const scanRoots = roots.length > 0 ? roots : ["src", "scripts"];

/** Paths allowed to use non-native shims intentionally. */
const ALLOWLIST = new Set([
  "scripts/deep-native-scan.ts",
  "src/lib/bun-native-shim.ts",
  "src/lib/bun-install-config.ts",
]);

/**
 * Closed audit items (intentional Web-standard / policy paths — no tier rule):
 * - Buffer.from / Buffer.concat — Uint8Array subclass; native Bun/Node compat
 *   @see https://bun.com/docs/runtime/binary-data#buffer
 * - TextEncoder / TextDecoder — Web-standard UTF-8 ↔ Uint8Array/DataView (guides/binary/*)
 *   @see https://bun.com/docs/runtime/binary-data#conversion
 * - btoa/atob in bun-utils string wrappers only; bytes use Uint8Array.toBase64/fromBase64
 *   @see https://bun.com/guides/util/base64
 * - Bun.write(path, data) — documented atomic fast path; writer() for incremental streams
 *   @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
 * - setInterval hold-timer (herdr-dashboard-cron ref/unref)
 * - process.env (3 policy paths)
 * - performance.now (docs-only in bun-install-config)
 * - Bun.Glob.scanSync({ cwd }) — tree walks; SSOT `scanTreeSync()` in src/lib/globs.ts
 * - import.meta.dir — `scriptRepoRoot()` in src/lib/paths.ts (not process.cwd() in scripts)
 * - Bun.$ — throwaway shell only (4 sites); file/tree cleanup uses Bun.file().delete / removePath
 */

type TierRule = {
  tier: number;
  pattern: string;
  native: string;
  test: (text: string) => boolean;
};

const TIERS: TierRule[] = [
  {
    tier: 1,
    pattern: "Response(stream) intermediate",
    native: "readableStreamToText() / Bun.readableStreamTo*",
    test: (t) => /new\s+Response\s*\([^)]*\)\.(text|arrayBuffer|json)\s*\(/.test(t),
  },
  {
    tier: 2,
    pattern: "JSON.stringify+console",
    native: "Bun.inspect({depth, colors, compact})",
    test: (t) => t.includes("JSON.stringify") && /console\.(log|error|warn|info)/.test(t),
  },
  {
    tier: 4,
    pattern: "new URL+import.meta.url",
    native: "import.meta.resolve()",
    test: (t) => t.includes("new URL(") && t.includes("import.meta.url"),
  },
  {
    tier: 5,
    pattern: "manual close/stop",
    native: "using / await using",
    test: (t) =>
      /\.(close|stop|terminate)\s*\(\s*\)/.test(t) &&
      !/using\s/.test(t) &&
      !/Symbol\.dispose/.test(t),
  },
  {
    tier: 6,
    pattern: "maxProbes counter",
    native: "AbortController + AbortSignal",
    test: (t) => /maxProbes|probeCount\s*\+\+/.test(t),
  },
  {
    tier: 6,
    pattern: "promise-hang",
    native: "AbortSignal on Bun.sleep",
    test: (t) => /new Promise\s*\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(t),
  },
  {
    tier: 7,
    pattern: "performance.now",
    native: "Bun.nanoseconds()",
    test: (t) => /performance\.now\s*\(/.test(t),
  },
  {
    tier: 8,
    pattern: "large-op-no-gc",
    native: "Bun.gc(true) before heavy ops",
    test: (t) => /(scanOffThread|eliminateOffThread|ast-scanner)/.test(t) && !t.includes("Bun.gc"),
  },
  {
    tier: 9,
    pattern: "string-sse-accum",
    native: "ReadableStream controller",
    test: (t) => /text\/event-stream/.test(t) && t.includes("+=") && t.includes("data:"),
  },
  {
    tier: 10,
    pattern: "import.meta.main block",
    native: "top-level await",
    test: (t) => /if\s*\(\s*import\.meta\.main\s*\)/.test(t),
  },
  {
    tier: 11,
    pattern: "string-const-literals",
    native: "const enum",
    test: (t) =>
      /export const [A-Z][A-Z0-9_]+\s*=\s*["'][^"']+["']/.test(t) &&
      t.includes("network-types") === false,
  },
  {
    tier: 12,
    pattern: "Record annotation",
    native: "satisfies Record<...>",
    test: (t) => /:\s*Record<string,\s*\w+>\s*=/.test(t) && !t.includes("satisfies"),
  },
  {
    tier: 13,
    pattern: "as any",
    native: "unknown + type guards",
    test: (t) => /\bas any\b/.test(t),
  },
  {
    tier: 14,
    pattern: "JSON.parse+readFile",
    native: "Bun.file().json() or import with { type: json }",
    test: (t) =>
      (t.includes("JSON.parse") && /readFile|\.text\(\)/.test(t)) ||
      /JSON\.parse\s*\(\s*await\s+readFile/.test(t),
  },
  {
    tier: 15,
    pattern: "file-url-pathname",
    native: "Bun.fileURLToPath / Bun.pathToFileURL",
    test: (t) =>
      /new URL\s*\(\s*["']file:/.test(t) || (/\.pathname/.test(t) && t.includes("file://")),
  },
];

const glob = new Glob("**/*.{ts,tsx}");
const issues: Array<{ file: string; pattern: string; tier: number; native: string }> = [];

for (const root of scanRoots) {
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
    if (file.includes("node_modules") || file.includes(".tmp")) continue;
    const path = `${root}/${file}`;
    if (ALLOWLIST.has(path)) continue;
    const text = await Bun.file(path).text();
    for (const rule of TIERS) {
      if (rule.test(text)) {
        issues.push({
          file: path,
          pattern: rule.pattern,
          tier: rule.tier,
          native: rule.native,
        });
      }
    }
  }
}

issues.sort((a, b) => a.tier - b.tier || a.file.localeCompare(b.file));

if (jsonOut) {
  console.log(
    Bun.inspect({ roots: scanRoots, count: issues.length, issues }, { depth: 4, colors: false })
  );
  process.exit(0);
}

if (issues.length === 0) {
  console.log(`deep-native:scan — no flagged patterns under ${scanRoots.join(", ")}`);
  process.exit(0);
}

const byTier = new Map<number, number>();
for (const issue of issues) byTier.set(issue.tier, (byTier.get(issue.tier) ?? 0) + 1);

for (const issue of issues) {
  console.log(`tier ${String(issue.tier).padStart(2)}  ${issue.pattern.padEnd(28)}  ${issue.file}`);
}
console.log(
  `\ndeep-native:scan — ${issues.length} hit(s) across tiers: ${[...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, n]) => `${t}=${n}`)
    .join(", ")}`
);
console.log("(informational — shims, scripts, and policy paths may be intentional)");
process.exit(0);
