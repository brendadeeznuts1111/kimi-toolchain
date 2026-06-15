#!/usr/bin/env bun
/**
 * Fail when toolchain tuning literals reappear or define naming rules are violated.
 *
 * SSOT: bunfig.toml `[define]` · Types: types/build-constants.d.ts
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
    pattern: /export const KIMI_ERROR_EMBEDDING_DIM\s*=\s*384\b/,
    rule: "use KIMI_ERROR_EMBEDDING_DIM from bunfig [define]",
  },
  {
    pattern: /const HOLD_DAYS\s*=\s*7\b/,
    rule: "use KIMI_DECISION_SCORE_WINDOW_DAYS from bunfig [define]",
  },
  {
    pattern: /const DEFAULT_CLUSTER_THRESHOLD\s*=\s*0\.55\b/,
    rule: "use KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD from bunfig [define]",
  },
  {
    pattern: /"\.kimi\/var\/contract-observations\.ndjson"/,
    rule: "use KIMI_CONTRACT_OBSERVATIONS_PATH from bunfig [define]",
  },
];

const DEFINE_KEY = /^([A-Z][A-Z0-9_]*) = /;
const KIMI_PREFIX = /^KIMI_[A-Z0-9_]+$/;
const DEFINE_DOMAIN = /^# define-domain:([a-z][a-z0-9-]*)$/;
const LEGACY_TAG = /^# tag:/;

function lintDefineNaming(bunfigText: string): string[] {
  const violations: string[] = [];
  const lines = bunfigText.split("\n");
  let inDefine = false;
  let currentDomain: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "[define]") {
      inDefine = true;
      continue;
    }
    if (inDefine && line.startsWith("[") && line.endsWith("]")) break;

    if (!inDefine) continue;

    const domainMatch = line.match(DEFINE_DOMAIN);
    if (domainMatch) {
      currentDomain = domainMatch[1]!;
      continue;
    }
    if (LEGACY_TAG.test(line.trim())) {
      violations.push(`bunfig.toml:${i + 1} — use # define-domain:… not # tag:…`);
      continue;
    }

    const keyMatch = line.match(DEFINE_KEY);
    if (!keyMatch) continue;

    const key = keyMatch[1]!;
    if (!KIMI_PREFIX.test(key)) {
      violations.push(
        `bunfig.toml:${i + 1} — define keys must match KIMI_{DOMAIN}_{QUALIFIER} (${key})`
      );
    }
    if (key.endsWith("_ENABLED") && !line.includes('"true"') && !line.includes('"false"')) {
      violations.push(`bunfig.toml:${i + 1} — boolean define ${key} must be "true" or "false"`);
    }
    if (!key.endsWith("_ENABLED") && key.startsWith("ENABLE_")) {
      violations.push(
        `bunfig.toml:${i + 1} — use KIMI_*_ENABLED suffix for booleans, not ENABLE_* (${key})`
      );
    }
    if (currentDomain === null) {
      violations.push(`bunfig.toml:${i + 1} — ${key} must follow a # define-domain:… comment`);
    }
  }

  return violations;
}

function lintTypesNaming(typesText: string): string[] {
  const violations: string[] = [];
  const lines = typesText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("@tag ") && !line.includes("@defineDomain")) {
      violations.push(
        `types/build-constants.d.ts:${i + 1} — use @defineDomain, not @tag (taxonomy collision)`
      );
    }
    const decl = line.match(/^declare const ([A-Z][A-Z0-9_]*):/);
    if (decl && !KIMI_PREFIX.test(decl[1]!)) {
      violations.push(
        `types/build-constants.d.ts:${i + 1} — declare const must use KIMI_ prefix (${decl[1]})`
      );
    }
  }

  return violations;
}

function main(): void {
  const violations: string[] = [];

  violations.push(...lintDefineNaming(readFileSync(join(ROOT, "bunfig.toml"), "utf8")));
  violations.push(
    ...lintTypesNaming(readFileSync(join(ROOT, "types/build-constants.d.ts"), "utf8"))
  );

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

  console.log(`lint:build-constants OK (${TARGETS.length} lib files, naming rules)`);
}

main();
