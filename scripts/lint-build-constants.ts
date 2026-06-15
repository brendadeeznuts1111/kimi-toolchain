#!/usr/bin/env bun
/**
 * Fail when toolchain tuning literals reappear instead of bunfig [define] globals.
 *
 * SSOT: bunfig.toml `[define]` · Types: types/build-constants.d.ts
 *
 * | Constant | Tag | Consumers (Phase 1) |
 * | -------- | --- | ------------------- |
 * | KIMI_OBSERVATIONS_PATH | contract-inference | paths.ts |
 * | KIMI_CONTRACT_SCHEMA_VERSION | contract-inference | contract-inference.ts |
 * | ENABLE_CONTRACT_INFERENCE | contract-inference | contract-inference.ts |
 * | HOOK_VERIFIER_MAX_CYCLES | hook-verifier | hook-verifier.ts |
 * | EMBEDDING_DIM | self-healing | (Phase 2: error-embedding.ts) |
 * | DECISION_SCORE_WINDOW_DAYS | self-healing | (Phase 2: decision-scoring.ts) |
 * | CLUSTER_SIMILARITY_THRESHOLD | self-healing | (Phase 2: error-clustering.ts) |
 *
 * @see CODE_REFERENCES.md § Build-time constants
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const TARGETS = [
  "src/lib/paths.ts",
  "src/lib/contract-inference.ts",
  "src/lib/hook-verifier.ts",
] as const;

const FORBIDDEN: Array<{ pattern: RegExp; rule: string }> = [
  {
    pattern: /export const EMBEDDING_DIM\s*=\s*384\b/,
    rule: "use EMBEDDING_DIM from bunfig [define]",
  },
  {
    pattern: /const HOLD_DAYS\s*=\s*7\b/,
    rule: "use DECISION_SCORE_WINDOW_DAYS from bunfig [define]",
  },
  {
    pattern: /const DEFAULT_CLUSTER_THRESHOLD\s*=\s*0\.55\b/,
    rule: "use CLUSTER_SIMILARITY_THRESHOLD from bunfig [define]",
  },
  {
    pattern: /"\.kimi\/var\/contract-observations\.ndjson"/,
    rule: "use KIMI_OBSERVATIONS_PATH from bunfig [define]",
  },
];

function main(): void {
  const violations: string[] = [];

  for (const rel of TARGETS) {
    const path = join(ROOT, rel);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { pattern, rule } of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push(`${rel}:${i + 1} — ${rule}\n  ${line.trim()}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("lint:build-constants failed:\n");
    for (const v of violations) console.error(v);
    process.exit(1);
  }

  console.log(`lint:build-constants OK (${TARGETS.length} files)`);
}

main();
