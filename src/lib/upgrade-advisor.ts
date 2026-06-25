/**
 * upgrade-advisor.ts — Bun upgrade / codebase scanner.
 * Detects legacy patterns and suggests Bun-native replacements.
 *
 * CLI: scripts/scan.ts · scaffold family per template-matrix.md
 */

import { join, relative } from "path";
import { pathExists } from "./bun-io.ts";
import { safeToml } from "./utils.ts";

/** Result of applying an auto-fix to a finding. */
export interface AutoFixResult {
  ok: boolean;
  /** Unified diff of the change (empty if fix couldn't be applied). */
  diff: string;
}

export interface UpgradeFinding {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
  snippet: string;
  /** Optional auto-fix function. Present only for mechanically-fixable rules. */
  autoFix?: () => AutoFixResult;
}

export interface UpgradeScanReport {
  schemaVersion: 1;
  tool: "upgrade-advisor";
  projectRoot: string;
  findings: UpgradeFinding[];
  summary: {
    total: number;
    byRule: Record<string, number>;
  };
}

export interface UpgradeScanOptions {
  /** Limit to specific rule ids */
  rules?: string[];
}

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"] as const;
const SCAN_DIRS = ["src", "scripts"] as const;

const SHARP_PATTERNS = [
  /require\s*\(\s*['"]sharp['"]\s*\)/,
  /import\s+sharp\s+from\s+['"]sharp['"]/,
  /from\s+['"]sharp['"]/,
] as const;

const WATCHER_PATTERNS = [
  /require\s*\(\s*['"]chokidar['"]\s*\)/,
  /from\s+['"]chokidar['"]/,
  /require\s*\(\s*['"]node-watch['"]\s*\)/,
  /from\s+['"]node-watch['"]/,
  /setInterval\s*\([^)]*watch/i,
] as const;

const SOURCE_MAP_PATTERNS = [
  /from\s+['"]source-map['"]/,
  /from\s+['"]source-map-js['"]/,
  /from\s+['"]@jridgewell\/trace-mapping['"]/,
  /from\s+['"]@jridgewell\/sourcemap-codec['"]/,
  /require\s*\(\s*['"]source-map['"]\s*\)/,
  /new\s+SourceMapConsumer\s*\(/,
  /decode\s*\(\s*[^)]*mappings/i,
  /JSON\.parse\s*\([^)]*mappings/i,
] as const;

const UNIX_HTTP_PATTERNS = [
  /Bun\.connect\s*\(\s*\{[^}]*\bunix\s*:/,
  /from\s+['"]node:net['"]/,
  /net\.connect\s*\(\s*['"][^'"]+\.sock['"]/,
] as const;

const PARALLEL_TEST_SCRIPTS = ["test:ci", "test:changed", "test:changed:push"] as const;

/**
 * Build an autoFix for the bun-serve-http3 rule.
 * Inserts `http3: true,` after the tls block in a Bun.serve() call.
 */
function buildHttp3AutoFix(
  absPath: string,
  lines: string[],
  serveLineIdx: number
): () => AutoFixResult {
  return () => {
    const result: AutoFixResult = { ok: false, diff: "" };
    try {
      let depth = 0;
      let started = false;
      let insertIdx = -1;

      for (let i = serveLineIdx; i < lines.length; i++) {
        const line = lines[i]!;
        for (const ch of line) {
          if (ch === "{") {
            depth++;
            started = true;
          }
          if (ch === "}") {
            depth--;
            if (started && depth === 0) {
              insertIdx = i;
              break;
            }
          }
        }
        if (insertIdx >= 0) break;
      }

      if (insertIdx < 0) return result;

      const indent = lines[insertIdx]!.match(/^(\s*)/)?.[1] ?? "  ";
      const originalLine = lines[insertIdx]!;
      const fixedLine = `${indent}  http3: true,\n${originalLine}`;
      const modified = [...lines];
      modified[insertIdx] = fixedLine;

      // Write the patched file
      Bun.write(absPath, modified.join("\n"));

      result.ok = true;
      result.diff = `  ${originalLine.trim()}\n+ ${indent}  http3: true,\n  ${originalLine.trim()}`;
      return result;
    } catch {
      return result;
    }
  };
}

function finding(
  ruleId: string,
  file: string,
  line: number,
  message: string,
  suggestion: string,
  snippet: string,
  autoFix?: () => AutoFixResult
): UpgradeFinding {
  return { ruleId, file, line, message, suggestion, snippet: snippet.trim(), autoFix };
}

function ruleEnabled(ruleId: string, options: UpgradeScanOptions): boolean {
  if (!options.rules?.length) return true;
  return options.rules.includes(ruleId);
}

function scanSourceFile(
  rel: string,
  absPath: string,
  lines: string[],
  out: UpgradeFinding[],
  options: UpgradeScanOptions
): void {
  if (ruleEnabled("sharp-to-bun-image", options)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (SHARP_PATTERNS.some((re) => re.test(line))) {
        out.push(
          finding(
            "sharp-to-bun-image",
            rel,
            i + 1,
            "sharp import detected",
            "Use Bun.Image: await Bun.file(path).arrayBuffer() then new Bun.Image(bytes) or Bun.file(path).image()",
            line
          )
        );
      }
    }
  }

  if (ruleEnabled("fetch-http2-multiplex", options)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/Promise\.all\s*\(/.test(line)) continue;
      let fetchCount = 0;
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const block = lines[j]!;
        fetchCount += (block.match(/\bfetch\s*\(/g) ?? []).length;
      }
      if (fetchCount >= 2) {
        out.push(
          finding(
            "fetch-http2-multiplex",
            rel,
            i + 1,
            "Multiple fetch() calls near Promise.all — same-origin requests may not multiplex",
            'Enable BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1 or pass protocol: "http2" on fetch options',
            line
          )
        );
      }
    }
  }

  if (ruleEnabled("bun-serve-http3", options)) {
    const text = lines.join("\n");
    if (
      /Bun\.serve\s*\(/.test(text) &&
      /\btls\s*:/.test(text) &&
      !/\bhttp3\s*:\s*true/.test(text)
    ) {
      const lineIdx = lines.findIndex((l) => /Bun\.serve\s*\(/.test(l));
      if (lineIdx >= 0) {
        out.push(
          finding(
            "bun-serve-http3",
            rel,
            lineIdx + 1,
            "Bun.serve with TLS but http3: true not set",
            "Add http3: true to Bun.serve({ tls: ..., http3: true }) for HTTP/3 over QUIC",
            lines[lineIdx]!,
            buildHttp3AutoFix(absPath, lines, lineIdx)
          )
        );
      }
    }
  }

  if (ruleEnabled("legacy-file-watchers", options)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (WATCHER_PATTERNS.some((re) => re.test(line))) {
        out.push(
          finding(
            "legacy-file-watchers",
            rel,
            i + 1,
            "Legacy file watcher or polling pattern",
            "Delete DX watch loops; keep only direct Bun.sleep runtime polling where removal breaks infra",
            line
          )
        );
      }
    }
  }

  if (ruleEnabled("manual-source-map-decode", options)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!SOURCE_MAP_PATTERNS.some((re) => re.test(line))) continue;
      out.push(
        finding(
          "manual-source-map-decode",
          rel,
          i + 1,
          "Manual source map decode in application code",
          "Prefer Bun stack traces / built-in source map handling; avoid decoding mappings in hot paths (high memory use)",
          line
        )
      );
    }
  }

  if (ruleEnabled("unix-socket-ws-upgrade", options)) {
    const text = lines.join("\n");
    const alreadyWs =
      /ws\+unix:\/\//.test(text) ||
      /wss\+unix:\/\//.test(text) ||
      /resolveHerdrWsUnixUrl/.test(text) ||
      /connectHerdrWebSocket/.test(text);
    if (alreadyWs) return;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!UNIX_HTTP_PATTERNS.some((re) => re.test(line))) continue;
      if (/herdr-unix-socket\.ts/.test(rel)) continue;
      out.push(
        finding(
          "unix-socket-ws-upgrade",
          rel,
          i + 1,
          "Raw unix socket client for service IPC",
          'Consider WebSocket over unix: new WebSocket("ws+unix:///path/to.sock:/") (Bun ≥1.3.13)',
          line
        )
      );
    }
  }
}

async function scanSourceTree(
  projectRoot: string,
  options: UpgradeScanOptions
): Promise<UpgradeFinding[]> {
  const findings: UpgradeFinding[] = [];
  for (const dir of SCAN_DIRS) {
    const absDir = join(projectRoot, dir);
    if (!pathExists(absDir)) continue;
    for (const pattern of SOURCE_GLOBS) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: absDir, absolute: false })) {
        if (file.includes("node_modules")) continue;
        const abs = join(absDir, file);
        const rel = relative(projectRoot, abs);
        const text = await Bun.file(abs).text();
        scanSourceFile(rel, abs, text.split("\n"), findings, options);
      }
    }
  }
  return filterByRules(findings, options);
}

async function scanBunfig(
  projectRoot: string,
  options: UpgradeScanOptions
): Promise<UpgradeFinding[]> {
  if (!ruleEnabled("global-store-disabled", options)) return [];
  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (!pathExists(bunfigPath)) return [];

  const text = await Bun.file(bunfigPath).text();
  const parsed = safeToml<{ install?: { linker?: string; globalStore?: boolean } }>(text, {});
  const install = parsed?.install;
  if (!install) return [];

  const linker = String(install.linker ?? "").toLowerCase();
  const usesIsolated = linker.includes("isolated");
  const globalStore = install.globalStore === true;

  if (usesIsolated && !globalStore) {
    const lineIdx = text.split("\n").findIndex((l) => /^\s*linker\s*=/.test(l));
    return [
      finding(
        "global-store-disabled",
        "bunfig.toml",
        lineIdx >= 0 ? lineIdx + 1 : 1,
        'linker = "isolated" without globalStore = true',
        `Add globalStore = true under [install] (Bun ≥1.3.14).

Official benchmarks (1,400-pkg fixture, Apple Silicon):
  hoisted:              823 ms
  isolated (no store):  841 ms
  isolated + global:    115 ms  → 7.3× faster warm installs

Disk: ~5 MB of symlinks per project instead of 391 MB.
Break-even at 1 project; every extra checkout is free.

Packages with patches, trustedDependencies, or workspace:/file:/link:
stay project-local automatically (ineligibility propagates).
Clear with: bun pm cache rm`,
        lineIdx >= 0 ? text.split("\n")[lineIdx]! : "[install]"
      ),
    ];
  }
  return [];
}

async function scanPackageJson(
  projectRoot: string,
  options: UpgradeScanOptions
): Promise<UpgradeFinding[]> {
  const pkgPath = join(projectRoot, "package.json");
  if (!pathExists(pkgPath)) return [];

  const findings: UpgradeFinding[] = [];
  const text = await Bun.file(pkgPath).text();
  const pkg = JSON.parse(text) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const lines = text.split("\n");

  if (ruleEnabled("missing-no-orphans", options)) {
    for (const [name, cmd] of Object.entries(scripts)) {
      if (!/\bbun\b/.test(cmd)) continue;
      if (name.startsWith("check:")) continue;
      const longRunning =
        /^(dev|start|serve|watch)$/.test(name) ||
        /\bBun\.serve\s*\(/.test(cmd) ||
        (/\b(dev|start|serve)\b/.test(cmd) && /\bsrc\/index\.(ts|js)/.test(cmd));
      if (!longRunning) continue;
      if (/--no-orphans\b/.test(cmd)) continue;
      const lineIdx = lines.findIndex((l) => l.includes(`"${name}"`));
      findings.push(
        finding(
          "missing-no-orphans",
          "package.json",
          lineIdx >= 0 ? lineIdx + 1 : 1,
          `Script "${name}" runs Bun without --no-orphans`,
          "Add --no-orphans to long-running server scripts: bun --no-orphans run …",
          `"${name}": "${cmd}"`
        )
      );
    }
  }

  if (ruleEnabled("missing-parallel-test-scripts", options)) {
    const missing = PARALLEL_TEST_SCRIPTS.filter((key) => !scripts[key]);
    if (missing.length > 0 && scripts.test) {
      const lineIdx = lines.findIndex((l) => l.includes('"test"'));
      findings.push(
        finding(
          "missing-parallel-test-scripts",
          "package.json",
          lineIdx >= 0 ? lineIdx + 1 : 1,
          `Missing parallel/shard test scripts: ${missing.join(", ")}`,
          'Add: "test:ci": "bun test --timeout 30000 --isolate --parallel --shard=${CI_NODE_INDEX:-1}/${CI_NODE_TOTAL:-1}", "test:changed", "test:changed:push"',
          missing.map((k) => `"${k}"`).join(", ")
        )
      );
    }
  }

  if (ruleEnabled("electron-to-bun-webview", options)) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const pkgName of ["electron", "nw", "nwjs"]) {
      if (!(pkgName in deps)) continue;
      const lineIdx = lines.findIndex((l) => l.includes(`"${pkgName}"`));
      findings.push(
        finding(
          "electron-to-bun-webview",
          "package.json",
          lineIdx >= 0 ? lineIdx + 1 : 1,
          `Dependency "${pkgName}" detected`,
          "Consider Bun.WebView + Bun.serve for desktop UI instead of Electron/nw.js",
          `"${pkgName}": "${deps[pkgName] ?? ""}"`
        )
      );
    }
  }

  return findings;
}

function filterByRules(findings: UpgradeFinding[], options: UpgradeScanOptions): UpgradeFinding[] {
  if (!options.rules?.length) return findings;
  return findings.filter((f) => options.rules!.includes(f.ruleId));
}

function summarize(findings: UpgradeFinding[]): UpgradeScanReport["summary"] {
  const byRule: Record<string, number> = {};
  for (const f of findings) {
    byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
  }
  return { total: findings.length, byRule };
}

/** Scan project for Bun upgrade opportunities. Advisory by default (exit 0). */
export async function scanUpgradeAdvisor(
  projectRoot: string,
  options: UpgradeScanOptions = {}
): Promise<UpgradeScanReport> {
  const [source, bunfig, pkg] = await Promise.all([
    scanSourceTree(projectRoot, options),
    scanBunfig(projectRoot, options),
    scanPackageJson(projectRoot, options),
  ]);
  const findings = [...source, ...bunfig, ...pkg];
  return {
    schemaVersion: 1,
    tool: "upgrade-advisor",
    projectRoot,
    findings,
    summary: summarize(findings),
  };
}

export function formatUpgradeReportHuman(report: UpgradeScanReport): string {
  if (report.findings.length === 0) {
    return "upgrade-advisor: no findings\n";
  }
  const lines: string[] = [`upgrade-advisor: ${report.summary.total} finding(s)\n`];
  for (const f of report.findings) {
    lines.push(`${f.file}:${f.line} [${f.ruleId}] ${f.message}`);
    lines.push(`  → ${f.suggestion}`);
    lines.push(`  ${f.snippet}\n`);
  }
  return lines.join("\n");
}

export const UPGRADE_ADVISOR_RULE_IDS = [
  "sharp-to-bun-image",
  "fetch-http2-multiplex",
  "bun-serve-http3",
  "legacy-file-watchers",
  "global-store-disabled",
  "missing-no-orphans",
  "missing-parallel-test-scripts",
  "electron-to-bun-webview",
  "manual-source-map-decode",
  "unix-socket-ws-upgrade",
] as const;

export type UpgradeAdvisorRuleId = (typeof UPGRADE_ADVISOR_RULE_IDS)[number];
