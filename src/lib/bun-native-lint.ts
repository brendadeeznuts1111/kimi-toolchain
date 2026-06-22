/**
 * Bun-native lint engine — rule registry, config, baseline ratchet.
 * CLI wrapper: scripts/lint-bun-native.ts
 */

import { join } from "path";

export type RuleMode = "off" | "report" | "enforce";

export interface Violation {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  snippet: string;
  replacement: string;
}

export interface RuleDefinition {
  id: string;
  message: string;
  replacement: string;
  defaultMode: RuleMode;
  /** Path prefixes; default scans all TypeScript under src/ */
  scope?: string[];
  detect: (ctx: ScanContext) => Violation[];
}

export interface ScanContext {
  rel: string;
  lines: string[];
  lineHasExemption: (line: string) => boolean;
}

export interface BunNativeLintConfig {
  schemaVersion: number;
  gateMode: "check" | "report";
  rules: Record<string, RuleMode>;
  /** Files skipped by import/require rules (central sync boundary). */
  exemptFiles?: string[];
}

export interface BaselineEntry {
  ruleId: string;
  file: string;
  line: number;
  snippet: string;
}

export interface BaselineFile {
  schemaVersion: number;
  updatedAt: string;
  entries: BaselineEntry[];
}

export interface LintResult {
  violations: Violation[];
  byRule: Record<string, Violation[]>;
  newViolations: Violation[];
  enforceViolations: Violation[];
  baselinedViolations: Violation[];
}

const BANNED_IMPORTS: Record<string, string> = {
  "node:child_process": "Bun.spawn / Bun.spawnSync",
  "node:fs": "Bun.file / Bun.write",
  fs: "Bun.file / Bun.write",
  "node:http": "Bun.serve",
  "node:https": "Bun.serve",
  "node:crypto": "Bun.hash / Bun.CryptoHasher",
  "node:zlib": "Bun.deflateSync / Bun.gunzipSync",
  "node:dns": "Bun.dns",
  "node:events": "Effect Stream",
  glob: "Bun.Glob",
  "fast-glob": "Bun.Glob",
  toml: "Bun.TOML",
  "@iarna/toml": "Bun.TOML",
  semver: "Bun.semver",
  bcrypt: "Bun.password",
  bcryptjs: "Bun.password",
  argon2: "Bun.password",
  which: "Bun.which",
};

const SYNC_FS_API =
  /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|mkdirSync|rmSync|statSync|copyFileSync|unlinkSync)\s*\(/;

const SLEEP_SETTIMEOUT = /new\s+Promise\s*[<(][^>)]*\)\s*=>\s*setTimeout|setTimeout\s*\(\s*resolve/;

const PROCESS_ARGV = /\bprocess\.argv\b/;

const RESPONSE_STREAM_TEXT = /new\s+Response\s*\([^)]*\)\.text\s*\(\s*\)/;

const RAW_BUN_SPAWN = /Bun\.spawn\s*\(\s*(?!\s*withBunNoOrphans\s*\()\s*\[\s*["']bun["']/;
const RAW_BUN_EXECPATH_SPAWN =
  /Bun\.spawn(?:Sync)?\s*\(\s*(?!\s*withBunNoOrphans\s*\()[^)]*process\.execPath/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ignore matches inside string literals (meta-linter safe). */
function stripStringLiterals(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function inScope(rel: string, scope: string[] | undefined): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.some((prefix) => rel.startsWith(prefix));
}

function lineViolations(
  ctx: ScanContext,
  ruleId: string,
  message: string,
  replacement: string,
  lineNo: number,
  line: string
): Violation[] {
  return [
    {
      ruleId,
      file: ctx.rel,
      line: lineNo,
      message,
      snippet: line.trim().slice(0, 120),
      replacement,
    },
  ];
}

function scanLineMatches(
  ctx: ScanContext,
  ruleId: string,
  message: string,
  replacement: string,
  regex: RegExp,
  scope?: string[]
): Violation[] {
  if (!inScope(ctx.rel, scope)) return [];
  const out: Violation[] = [];
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i] ?? "";
    const lineNo = i + 1;
    if (line.trim().startsWith("//")) continue;
    if (ctx.lineHasExemption(line)) continue;
    const code = stripStringLiterals(line);
    if (!regex.test(code)) continue;
    regex.lastIndex = 0;
    out.push(...lineViolations(ctx, ruleId, message, replacement, lineNo, line));
  }
  return out;
}

const bannedImportRegex = new RegExp(
  `from\\s+["'](${Object.keys(BANNED_IMPORTS).map(escapeRegExp).join("|")})["']`,
  "g"
);
const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
const processEnvRegex = /\bprocess\.env\b/g;
const stringifyStdoutRegex =
  /(?:console\.(log|error|warn|info|debug)|process\.stdout\.write)\s*\([^)]*JSON\.stringify\s*\(/g;

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    id: "banned-import",
    message: "Banned import — use Bun-native API",
    replacement: "see rule catalog",
    defaultMode: "report",
    detect(ctx) {
      const out: Violation[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        const line = ctx.lines[i] ?? "";
        const lineNo = i + 1;
        if (line.trim().startsWith("//") || ctx.lineHasExemption(line)) continue;
        for (const match of line.matchAll(bannedImportRegex)) {
          const name = match[1]!;
          out.push({
            ruleId: "banned-import",
            file: ctx.rel,
            line: lineNo,
            message: `banned import: ${name}`,
            snippet: line.trim().slice(0, 120),
            replacement: BANNED_IMPORTS[name] ?? "Bun-native equivalent",
          });
        }
      }
      return out;
    },
  },
  {
    id: "banned-require",
    message: "Banned require call — use Bun-native API",
    replacement: "see rule catalog",
    defaultMode: "report",
    detect(ctx) {
      const out: Violation[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        const line = ctx.lines[i] ?? "";
        const lineNo = i + 1;
        if (line.trim().startsWith("//") || ctx.lineHasExemption(line)) continue;
        for (const match of line.matchAll(requireRegex)) {
          const name = match[1]!;
          const replacement = BANNED_IMPORTS[name];
          if (!replacement) continue;
          out.push({
            ruleId: "banned-require",
            file: ctx.rel,
            line: lineNo,
            message: `banned require: ${name}`,
            snippet: line.trim().slice(0, 120),
            replacement,
          });
        }
      }
      return out;
    },
  },
  {
    id: "process-env",
    message: "Use Bun.env instead of process environment access",
    replacement: "Bun.env",
    defaultMode: "report",
    detect(ctx) {
      return scanLineMatches(
        ctx,
        "process-env",
        "process environment access",
        "Bun.env",
        processEnvRegex
      );
    },
  },
  {
    id: "stringify-stdout",
    message: "Use inspectAgent() for stdout JSON emission",
    replacement: "inspectAgent from src/lib/inspect.ts",
    defaultMode: "report",
    scope: ["src/lib/"],
    detect(ctx) {
      return scanLineMatches(
        ctx,
        "stringify-stdout",
        "JSON.stringify on stdout",
        "inspectAgent()",
        stringifyStdoutRegex,
        ["src/lib/"]
      );
    },
  },
  {
    id: "sync-fs-api",
    message: "Prefer Bun.file / Bun.write over sync fs APIs",
    replacement: "Bun.file(path).text() / Bun.write(path, data)",
    defaultMode: "off",
    detect(ctx) {
      return scanLineMatches(
        ctx,
        "sync-fs-api",
        "sync fs API",
        "Bun.file / Bun.write",
        SYNC_FS_API
      );
    },
  },
  {
    id: "sleep-settimeout",
    message: "Prefer Bun.sleep over Promise+setTimeout",
    replacement: "await Bun.sleep(ms)",
    defaultMode: "off",
    detect(ctx) {
      return scanLineMatches(
        ctx,
        "sleep-settimeout",
        "Promise setTimeout sleep",
        "Bun.sleep",
        SLEEP_SETTIMEOUT
      );
    },
  },
  {
    id: "process-argv",
    message: "Prefer Bun.argv in CLI code",
    replacement: "Bun.argv",
    defaultMode: "off",
    scope: ["src/bin/", "src/lib/"],
    detect(ctx) {
      return scanLineMatches(ctx, "process-argv", "process.argv", "Bun.argv", PROCESS_ARGV, [
        "src/bin/",
        "src/lib/",
      ]);
    },
  },
  {
    id: "response-stream-text",
    message: "Prefer readableStreamToText from bun-utils.ts",
    replacement: "readableStreamToText(stream)",
    defaultMode: "off",
    detect(ctx) {
      return scanLineMatches(
        ctx,
        "response-stream-text",
        "Response(stream).text()",
        "Bun.readableStreamToText",
        RESPONSE_STREAM_TEXT
      );
    },
  },
  {
    id: "spawn-no-orphans",
    message: "Bun.spawn must use --no-orphans for bun / process.execPath invocations",
    replacement: "withBunNoOrphans / spawnBun / withNoOrphansEnv",
    defaultMode: "report",
    scope: ["src/"],
    detect(ctx) {
      if (ctx.rel === "src/lib/tool-runner.ts") return [];
      const out: Violation[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        const line = ctx.lines[i] ?? "";
        const lineNo = i + 1;
        if (line.trim().startsWith("//") || ctx.lineHasExemption(line)) continue;
        const code = stripStringLiterals(line);
        const rawBun = RAW_BUN_SPAWN.test(code);
        RAW_BUN_SPAWN.lastIndex = 0;
        const rawExecPath = RAW_BUN_EXECPATH_SPAWN.test(code);
        RAW_BUN_EXECPATH_SPAWN.lastIndex = 0;
        if (!rawBun && !rawExecPath) continue;
        if (code.includes("--no-orphans") || code.includes("spawnBun(")) continue;
        const detail = rawExecPath
          ? "raw Bun.spawn with process.execPath without --no-orphans"
          : "raw Bun.spawn(['bun', ...]) without --no-orphans";
        out.push(
          ...lineViolations(
            ctx,
            "spawn-no-orphans",
            detail,
            "withBunNoOrphans / spawnBun",
            lineNo,
            line
          )
        );
      }
      return out;
    },
  },
];

export function violationKey(v: Pick<Violation, "ruleId" | "file" | "line">): string {
  return `${v.ruleId}::${v.file}::${v.line}`;
}

export function baselineKey(e: Pick<BaselineEntry, "ruleId" | "file" | "line">): string {
  return `${e.ruleId}::${e.file}::${e.line}`;
}

export function defaultConfig(): BunNativeLintConfig {
  const rules: Record<string, RuleMode> = {};
  for (const rule of RULE_DEFINITIONS) {
    rules[rule.id] = rule.defaultMode;
  }
  return {
    schemaVersion: 1,
    gateMode: "check",
    rules,
    exemptFiles: ["src/lib/bun-native-shim.ts", "src/lib/bun-io.ts"],
  };
}

export function mergeConfig(parsed: Partial<BunNativeLintConfig> | null): BunNativeLintConfig {
  const base = defaultConfig();
  if (!parsed) return base;
  return {
    schemaVersion: parsed.schemaVersion ?? base.schemaVersion,
    gateMode: parsed.gateMode ?? base.gateMode,
    rules: { ...base.rules, ...parsed.rules },
    exemptFiles: parsed.exemptFiles ?? base.exemptFiles,
  };
}

export function ruleMode(config: BunNativeLintConfig, ruleId: string): RuleMode {
  return config.rules[ruleId] ?? "off";
}

export function activeRules(config: BunNativeLintConfig): RuleDefinition[] {
  return RULE_DEFINITIONS.filter((rule) => ruleMode(config, rule.id) !== "off");
}

export function evaluateViolations(
  violations: Violation[],
  config: BunNativeLintConfig,
  baseline: BaselineFile | null
): LintResult {
  const baselineKeys = new Set((baseline?.entries ?? []).map(baselineKey));
  const byRule: Record<string, Violation[]> = {};
  const enforceViolations: Violation[] = [];
  const baselinedViolations: Violation[] = [];
  const newViolations: Violation[] = [];

  for (const v of violations) {
    byRule[v.ruleId] ??= [];
    byRule[v.ruleId]!.push(v);

    const mode = ruleMode(config, v.ruleId);
    if (mode === "off") continue;

    if (mode === "enforce") {
      enforceViolations.push(v);
      continue;
    }

    if (baselineKeys.has(violationKey(v))) {
      baselinedViolations.push(v);
    } else {
      newViolations.push(v);
    }
  }

  return { violations, byRule, newViolations, enforceViolations, baselinedViolations };
}

export function shouldFailCheck(
  result: LintResult,
  config: BunNativeLintConfig,
  gateMode: "check" | "report"
): boolean {
  if (gateMode === "report") return false;
  return result.enforceViolations.length > 0 || result.newViolations.length > 0;
}

export function buildBaselineFromViolations(
  violations: Violation[],
  config: BunNativeLintConfig,
  existing: BaselineFile | null,
  ruleFilter?: string
): BaselineFile {
  const reportViolations = violations.filter((v) => ruleMode(config, v.ruleId) === "report");
  const filtered = ruleFilter
    ? reportViolations.filter((v) => v.ruleId === ruleFilter)
    : reportViolations;

  const kept =
    ruleFilter && existing
      ? existing.entries.filter((e) => e.ruleId !== ruleFilter)
      : ruleFilter
        ? (existing?.entries ?? [])
        : [];

  const nextEntries: BaselineEntry[] = [
    ...kept,
    ...filtered.map((v) => ({
      ruleId: v.ruleId,
      file: v.file,
      line: v.line,
      snippet: v.snippet,
    })),
  ];

  const deduped = new Map<string, BaselineEntry>();
  for (const entry of nextEntries) {
    deduped.set(baselineKey(entry), entry);
  }

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    entries: [...deduped.values()].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
    ),
  };
}

function isRuleExempt(rel: string, ruleId: string, config: BunNativeLintConfig): boolean {
  const exempt = config.exemptFiles ?? [];
  if (!exempt.includes(rel)) return false;
  return ruleId === "banned-import" || ruleId === "banned-require" || ruleId === "sync-fs-api";
}

export async function scanFile(
  repoRoot: string,
  rel: string,
  config: BunNativeLintConfig
): Promise<Violation[]> {
  const rules = activeRules(config);
  const path = join(repoRoot, rel);
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return [];
  }

  const ctx: ScanContext = {
    rel,
    lines: text.split("\n"),
    lineHasExemption: (line) => line.includes("@bun-native-exempt"),
  };

  const violations: Violation[] = [];
  for (const rule of rules) {
    if (isRuleExempt(rel, rule.id, config)) continue;
    violations.push(...rule.detect(ctx));
  }
  return violations;
}

export async function scanRepo(
  repoRoot: string,
  config: BunNativeLintConfig
): Promise<Violation[]> {
  return scanGlobPatterns(repoRoot, ["src/**/*.ts"], config);
}

export async function scanGlobPatterns(
  repoRoot: string,
  patterns: readonly string[],
  config: BunNativeLintConfig,
  skipDirs: ReadonlySet<string> = new Set(["node_modules", ".git", "coverage"])
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      if (rel.split("/").some((seg) => skipDirs.has(seg))) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      violations.push(...(await scanFile(repoRoot, rel, config)));
    }
  }

  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
}

export function parseConfigToml(text: string): BunNativeLintConfig {
  const parsed = Bun.TOML.parse(text) as {
    schemaVersion?: number;
    gate?: { mode?: "check" | "report" };
    rules?: Record<string, RuleMode>;
    exemptFiles?: string[];
  };
  const exemptFiles =
    parsed.exemptFiles ?? (parsed as { exemptFiles?: { paths?: string[] } }).exemptFiles?.paths;
  return mergeConfig({
    schemaVersion: parsed.schemaVersion,
    gateMode: parsed.gate?.mode,
    rules: parsed.rules,
    exemptFiles,
  });
}

export function parseBaselineJson(text: string): BaselineFile {
  const parsed = JSON.parse(text) as BaselineFile;
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Invalid baseline: entries must be an array");
  }
  return parsed;
}

export function formatRuleCatalog(
  violations: Violation[],
  config: BunNativeLintConfig
): Array<{
  id: string;
  mode: RuleMode;
  count: number;
  replacement: string;
}> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    counts[v.ruleId] = (counts[v.ruleId] ?? 0) + 1;
  }
  return RULE_DEFINITIONS.map((rule) => ({
    id: rule.id,
    mode: ruleMode(config, rule.id),
    count: counts[rule.id] ?? 0,
    replacement: rule.replacement,
  }));
}
