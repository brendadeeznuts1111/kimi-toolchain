/**
 * effect-gates.ts — Effect discipline scanner and report builder.
 *
 * Enforces the tuning constants registered under the `effect-discipline` domain:
 *   - KIMI_EFFECT_MAX_DIRECT_PROMISE
 *   - KIMI_DOMAIN_PURITY_LEVEL
 *   - KIMI_LAYER_CIRCULARITY_TOLERANCE
 *   - KIMI_SERVICE_TAG_REQUIRED
 *   - KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED
 *
 * Produces an EffectGatesReport that callers should emit via
 * writer.writeJsonSchema("effect-gates-report", report) for schema-envelope safety.
 */

import { dirname, relative, resolve } from "path";
import ts from "typescript";
import { effectGatesPath } from "./paths.ts";
import { getProjectName, safeParse } from "./utils.ts";
import { makeDir } from "./bun-io.ts";

/** Report schema version. Bump only on breaking shape changes. */
export const EFFECT_GATES_REPORT_SCHEMA_VERSION = 1;

/** Gate identifiers — kept in sync with error-taxonomy.yml effect_gates_* entries. */
export const EFFECT_GATES = {
  directPromise: "direct-promise",
  layerCircularity: "layer-circularity",
  missingServiceTag: "missing-service-tag",
  domainPurity: "domain-purity",
  runPromiseBoundary: "run-promise-boundary",
  eventStream: "event-stream",
  consoleBoundary: "console-boundary",
  processEnvBoundary: "process-env-boundary",
  nodeFsPlugin: "node-fs-plugin",
} as const;

/** A single discipline violation. */
export interface EffectGatesViolation {
  /** Gate identifier. */
  gate: string;
  /** Severity derived from constant thresholds. */
  severity: "error" | "warn";
  /** Human-readable description. */
  message: string;
  /** File path and optional line number, e.g. "src/lib/foo.ts:42". */
  location?: string;
}

/** Summary counters for a report. */
export interface EffectGatesCounts {
  directPromise: number;
  layerCircularity: number;
  missingServiceTag: number;
  domainPurity: number;
  runPromiseBoundary: number;
  eventStream: number;
  consoleBoundary: number;
  processEnvBoundary: number;
  nodeFsPlugin: number;
}

/** Threshold snapshot baked into the report for reproducibility. */
export interface EffectGatesThresholds {
  maxDirectPromise: number;
  layerCircularityTolerance: number;
  serviceTagRequired: boolean;
  domainPurityLevel: "strict" | "gradual" | "off";
  runPromiseBoundaryEnabled: boolean;
  eventStreamsEnabled: boolean;
}

/** Discipline report emitted by buildEffectGatesReport. */
export interface EffectGatesReport {
  schemaVersion: number;
  tool: string;
  generatedAt: string;
  project: string;
  gitHead?: string;
  thresholds: EffectGatesThresholds;
  counts: EffectGatesCounts;
  summary: {
    total: number;
    errors: number;
    warnings: number;
  };
  violations: EffectGatesViolation[];
}

/** Options for buildEffectGatesReport. */
export interface BuildEffectGatesReportOptions {
  projectRoot: string;
  /** Tool name included in the report. */
  tool?: string;
  /** Optional git HEAD for snapshot correlation. */
  gitHead?: string;
  /** Scan scope — defaults to `src` + all nested `.ts` files. */
  include?: string[];
  /** Paths to exclude from scanning. */
  exclude?: string[];
  /** Override constant-derived thresholds for this run. */
  thresholdOverrides?: Partial<EffectGatesThresholds>;
}

/** Runtime thresholds loaded from bunfig [define] constants. */
function loadThresholds(): EffectGatesThresholds {
  const level = KIMI_DOMAIN_PURITY_LEVEL;
  return {
    maxDirectPromise: KIMI_EFFECT_MAX_DIRECT_PROMISE,
    layerCircularityTolerance: KIMI_LAYER_CIRCULARITY_TOLERANCE,
    serviceTagRequired: KIMI_SERVICE_TAG_REQUIRED,
    domainPurityLevel: level === "strict" || level === "gradual" || level === "off" ? level : "off",
    runPromiseBoundaryEnabled: KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED,
    eventStreamsEnabled: false,
  };
}

/** Resolve paths relative to projectRoot, defaulting to all `src` `.ts` files. */
async function resolveSourceFiles(
  projectRoot: string,
  include?: string[],
  exclude?: string[]
): Promise<string[]> {
  const patterns = include?.length ? include : ["src/**/*.ts"];
  const excluded = new Set(exclude ?? []);
  const files = new Set<string>();

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const relativePath of glob.scan({ cwd: projectRoot, absolute: false })) {
      const absolutePath = resolve(projectRoot, relativePath);
      if (!excluded.has(relativePath) && !excluded.has(absolutePath)) {
        files.add(absolutePath);
      }
    }
  }

  return [...files].sort();
}

/** Format a location string. */
function formatLocation(filePath: string, line?: number): string {
  return line !== undefined && line > 0 ? `${filePath}:${line}` : filePath;
}

/** True when `relativePath` is under a directory prefix like `src/bin/`. */
function isUnderDirPrefix(relativePath: string, dirPrefix: string): boolean {
  const dir = dirPrefix.endsWith("/") ? dirPrefix.slice(0, -1) : dirPrefix;
  return relativePath === dir || relativePath.startsWith(`${dir}/`);
}

/** True when `relativePath` matches any exclude glob (`scripts/**`, `src/bin/**`, …). */
function isExcludedByGlobs(relativePath: string, globs: readonly string[]): boolean {
  for (const glob of globs) {
    if (glob.endsWith("/**")) {
      const dir = glob.slice(0, -3);
      if (isUnderDirPrefix(relativePath, dir)) return true;
    } else if (relativePath === glob) {
      return true;
    }
  }
  return false;
}

/** True for Bun plugin paths targeted by node-fs-plugin (plugins/ and megaliner/ trees). */
function isPluginOrMegalinerPath(relativePath: string): boolean {
  return (
    relativePath.includes("/plugins/") ||
    relativePath.startsWith("plugins/") ||
    relativePath.includes("/megaliner/") ||
    relativePath.startsWith("megaliner/")
  );
}

interface ExcludedRange {
  start: number;
  end: number;
}

/** Collect ranges for comments and string/template literals so regex scanners can skip them. */
function getExcludedRanges(sourceFile: ts.SourceFile): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const text = sourceFile.text;
  const commentRegex = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  for (const match of text.matchAll(commentRegex)) {
    ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }

  return ranges.sort((a, b) => a.start - b.start);
}

const excludedRangeCache = new WeakMap<ts.SourceFile, ExcludedRange[]>();

/** Check whether a token is inside a comment or string literal. */
function isTokenInCommentOrString(sourceFile: ts.SourceFile, position: number): boolean {
  let ranges = excludedRangeCache.get(sourceFile);
  if (!ranges) {
    ranges = getExcludedRanges(sourceFile);
    excludedRangeCache.set(sourceFile, ranges);
  }
  for (const range of ranges) {
    if (position < range.start) return false;
    if (position < range.end) return true;
  }
  return false;
}

/**
 * Probe harness files embed bare Promise patterns as fixture strings — not runtime calls.
 * Keep in sync with LIB_PROBE_FIXTURES in scripts/lint-patterns.ts.
 */
const DIRECT_PROMISE_PROBE_FIXTURES = new Set([
  "src/lib/bun-cli-contract-probes.ts",
  "src/lib/bun-cli-env-probes.ts",
  "src/lib/bun-cli-bun-test-probes.ts",
  "src/lib/bun-cli-run-test-probes.ts",
  "src/lib/bun-cli-test-changed-probes.ts",
  "src/lib/bun-cli-markdown-probes.ts",
  "src/lib/bun-cli-fixture.ts",
  "src/lib/bun-install-config.ts",
  "src/lib/test-runtime.ts",
  "src/lib/build-info.ts",
  "src/lib/bun-utils.ts",
]);

/** Paths where bare Promise usage is permitted (tests, bins, scripts, Effect runtime). */
function isDirectPromiseExcludedPath(relativePath: string): boolean {
  if (DIRECT_PROMISE_PROBE_FIXTURES.has(relativePath)) return true;
  if (isExcludedByGlobs(relativePath, ["test/**", "src/bin/**", "scripts/**"])) return true;
  if (relativePath.includes("/effect/") || relativePath.startsWith("src/lib/effect/")) return true;
  return false;
}

/** Detect bare Promise usage in a source file. */
function scanDirectPromises(sourceFile: ts.SourceFile, filePath: string): EffectGatesViolation[] {
  if (isDirectPromiseExcludedPath(filePath)) return [];

  const violations: EffectGatesViolation[] = [];
  const text = sourceFile.text;
  const patterns = [
    { regex: /\bnew\s+Promise\b/g, label: "new Promise" },
    { regex: /\.then\s*\(/g, label: ".then()" },
    { regex: /\.catch\s*\(/g, label: ".catch()" },
    { regex: /\.finally\s*\(/g, label: ".finally()" },
  ];

  for (const { regex, label } of patterns) {
    for (const match of text.matchAll(regex)) {
      const pos = match.index ?? 0;
      if (isTokenInCommentOrString(sourceFile, pos)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
      violations.push({
        gate: EFFECT_GATES.directPromise,
        severity: "error",
        message: `Bare Promise usage: ${label}`,
        location: formatLocation(filePath, line),
      });
    }
  }

  return violations;
}

/**
 * Allowed locations for `Effect.runPromise` calls.
 *
 * Boundary policy: Effect program execution must start at the outer shell of
 * the runtime. Library/service code should return Effects and let the CLI or
 * runtime entry unwrap them.
 */
const RUN_PROMISE_ALLOWED_PATHS = ["src/bin/", "src/lib/effect/", "test/", "scripts/"] as const;

/**
 * Outer-shell entrypoints invoked by Bun, git hooks, or Kimi Code — same boundary
 * policy as scripts/ and src/bin/ (console, runPromise, process.env).
 */
const OUTER_SHELL_ALLOWED_FILES = new Set([
  "src/drift/check.ts",
  "src/guardian/verify.ts",
  "src/install-hooks/postinstall.ts",
  "src/kimi-hooks/log-tool-failure.ts",
]);

const OUTER_SHELL_ALLOWED_DIRS = ["src/doctor/deep-audit/"] as const;

/** Scanner implementation — must not self-flag on its own regex/messages. */
const EFFECT_GATES_SCANNER_FILE = "src/lib/effect-gates.ts";

function isOuterShellPath(relativePath: string): boolean {
  if (OUTER_SHELL_ALLOWED_FILES.has(relativePath)) return true;
  for (const dir of OUTER_SHELL_ALLOWED_DIRS) {
    if (isUnderDirPrefix(relativePath, dir)) return true;
  }
  return false;
}

/** Check whether a file path is allowed to call Effect.runPromise. */
function isRunPromiseAllowedPath(relativePath: string): boolean {
  if (relativePath === EFFECT_GATES_SCANNER_FILE) return true;
  if (isOuterShellPath(relativePath)) return true;
  for (const allowed of RUN_PROMISE_ALLOWED_PATHS) {
    if (allowed.endsWith("/")) {
      const dir = allowed.slice(0, -1);
      if (relativePath === dir || relativePath.startsWith(allowed)) return true;
    } else if (relativePath === allowed) {
      return true;
    }
  }
  return false;
}

/** Detect Effect.runPromise calls outside permitted CLI/runtime/test boundaries. */
function scanRunPromiseBoundary(
  sourceFile: ts.SourceFile,
  filePath: string,
  thresholds: EffectGatesThresholds
): EffectGatesViolation[] {
  if (!thresholds.runPromiseBoundaryEnabled) return [];
  if (isRunPromiseAllowedPath(filePath)) return [];

  const violations: EffectGatesViolation[] = [];
  const runPromiseCall = new RegExp(String.raw`\.runPromise(?:Exit)?\b`, "g");

  for (const match of sourceFile.text.matchAll(runPromiseCall)) {
    const pos = match.index ?? 0;
    if (isTokenInCommentOrString(sourceFile, pos)) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    violations.push({
      gate: EFFECT_GATES.runPromiseBoundary,
      severity: "error",
      message:
        "Effect.runPromise/runPromiseExit only allowed in tests, bin entrypoints, scripts, and src/lib/effect runtime",
      location: formatLocation(filePath, line),
    });
  }

  return violations;
}

/**
 * Probe harness files embed console snippets as fixture strings — not runtime calls.
 * Keep in sync with LIB_PROBE_FIXTURES / LIB_CONSOLE_ALLOW in scripts/lint-patterns.ts.
 */
const CONSOLE_BOUNDARY_PROBE_FIXTURES = DIRECT_PROMISE_PROBE_FIXTURES;

const CONSOLE_BOUNDARY_LIB_ALLOW = new Set([
  "src/lib/logger.ts",
  "src/lib/compile-target.ts",
  "src/lib/mcp-bridge-scaffold.ts",
  "src/lib/herdr-dashboard/webview/options.ts",
]);

/** Detect console.* outside scripts/ and src/bin/. */
function scanConsoleBoundary(sourceFile: ts.SourceFile, filePath: string): EffectGatesViolation[] {
  if (isExcludedByGlobs(filePath, ["scripts/**", "src/bin/**"])) return [];
  if (isOuterShellPath(filePath)) return [];
  if (CONSOLE_BOUNDARY_LIB_ALLOW.has(filePath) || CONSOLE_BOUNDARY_PROBE_FIXTURES.has(filePath)) {
    return [];
  }

  const violations: EffectGatesViolation[] = [];
  const regex = /console\.(log|warn|error|info|debug|dir|table)\s*\(/g;

  for (const match of sourceFile.text.matchAll(regex)) {
    const pos = match.index ?? 0;
    if (isTokenInCommentOrString(sourceFile, pos)) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    violations.push({
      gate: EFFECT_GATES.consoleBoundary,
      severity: "error",
      message: "console.* must not be used outside scripts/ and src/bin/; use canonical logger",
      location: formatLocation(filePath, line),
    });
  }

  return violations;
}

/**
 * Files that reference process.env as catalog/fixture text, not runtime access.
 * Keep in sync with scripts/lint-patterns.ts probe fixtures.
 */
const PROCESS_ENV_BOUNDARY_ALLOW = new Set([
  ...DIRECT_PROMISE_PROBE_FIXTURES,
  "src/doctor/secret-audit.ts",
  "src/lib/bun-upstream-cli-case-alignment.ts",
  "src/lib/effect-gates.ts",
]);

/** Detect process.env outside scripts/ and src/bin/. */
function scanProcessEnvBoundary(
  sourceFile: ts.SourceFile,
  filePath: string
): EffectGatesViolation[] {
  if (isExcludedByGlobs(filePath, ["scripts/**", "src/bin/**"])) return [];
  if (isOuterShellPath(filePath)) return [];
  if (PROCESS_ENV_BOUNDARY_ALLOW.has(filePath)) return [];

  const violations: EffectGatesViolation[] = [];
  const regex = /\bprocess\.env\b/g;

  for (const match of sourceFile.text.matchAll(regex)) {
    const pos = match.index ?? 0;
    if (isTokenInCommentOrString(sourceFile, pos)) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    violations.push({
      gate: EFFECT_GATES.processEnvBoundary,
      severity: "error",
      message: "process.env must not be used; use Bun.env",
      location: formatLocation(filePath, line),
    });
  }

  return violations;
}

/** Detect Node fs imports in Bun plugin / megaliner paths. */
function scanNodeFsInPlugin(sourceFile: ts.SourceFile, filePath: string): EffectGatesViolation[] {
  if (!isPluginOrMegalinerPath(filePath)) return [];

  const violations: EffectGatesViolation[] = [];
  const fsMod = "fs";
  const nodeFsMod = "node:" + fsMod;
  const fsImportLabels = [
    { module: fsMod, label: `import from "${fsMod}"` },
    { module: `${fsMod}/promises`, label: `import from "${fsMod}/promises"` },
    { module: nodeFsMod, label: `import from "${nodeFsMod}"` },
    { module: `${nodeFsMod}/promises`, label: `import from "${nodeFsMod}/promises"` },
  ];
  const patterns = fsImportLabels.map(({ module, label }) => ({
    regex: new RegExp(String.raw`from\s+["']` + module + String.raw`["']`, "g"),
    label,
  }));

  for (const { regex, label } of patterns) {
    for (const match of sourceFile.text.matchAll(regex)) {
      const pos = match.index ?? 0;
      if (isTokenInCommentOrString(sourceFile, pos)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
      violations.push({
        gate: EFFECT_GATES.nodeFsPlugin,
        severity: "error",
        message: `Use Bun.file/Bun.write instead of Node fs in Bun plugins (${label})`,
        location: formatLocation(filePath, line),
      });
    }
  }

  return violations;
}

/** Detect Node.js EventEmitter usage in service code that should be Effect streams. */
function scanEventStreams(
  sourceFile: ts.SourceFile,
  filePath: string,
  thresholds: EffectGatesThresholds
): EffectGatesViolation[] {
  if (!thresholds.eventStreamsEnabled) return [];
  if (!filePath.startsWith("src/services/")) return [];

  const violations: EffectGatesViolation[] = [];
  const text = sourceFile.text;
  const patterns = [
    { regex: /\bnew\s+EventEmitter\b/g, label: "new EventEmitter" },
    { regex: /\bnew\s+CustomEmitter\b/g, label: "new CustomEmitter" },
    { regex: /\bEventEmitter\b/g, label: "EventEmitter reference" },
    { regex: /\bCustomEmitter\b/g, label: "CustomEmitter reference" },
    { regex: /from\s+["']events["']/g, label: "events module import" },
    { regex: /require\s*\(\s*["']events["']\s*\)/g, label: "events module require" },
  ];

  for (const { regex, label } of patterns) {
    for (const match of text.matchAll(regex)) {
      const pos = match.index ?? 0;
      if (isTokenInCommentOrString(sourceFile, pos)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
      violations.push({
        gate: EFFECT_GATES.eventStream,
        severity: "error",
        message: `EventEmitter-style code should be an Effect stream: ${label}`,
        location: formatLocation(filePath, line),
      });
    }
  }

  return violations;
}

/** Build a simple import graph for layer-circularity detection. */
function buildImportGraph(
  sourceFiles: ts.SourceFile[],
  compilerOptions: ts.CompilerOptions
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const sourceFile of sourceFiles) {
    const from = sourceFile.fileName;
    const imports = new Set<string>();
    graph.set(from, imports);

    sourceFile.forEachChild((node) => {
      if (!ts.isImportDeclaration(node)) return;
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const target = moduleSpecifier.text;
      if (!target.startsWith(".")) {
        // Track external effect imports separately.
        imports.add(`__external:${target}`);
        return;
      }

      const resolved = ts.resolveModuleName(target, sourceFile.fileName, compilerOptions, ts.sys);
      if (resolved.resolvedModule) {
        imports.add(resolved.resolvedModule.resolvedFileName);
      }
    });
  }

  return graph;
}

/** Detect circular relative imports that involve effect/Layer modules. */
function scanLayerCircularity(
  sourceFiles: ts.SourceFile[],
  filePathMap: Map<string, string>,
  thresholds: EffectGatesThresholds
): EffectGatesViolation[] {
  if (thresholds.layerCircularityTolerance > 0) return [];
  const violations: EffectGatesViolation[] = [];
  const graph = buildImportGraph(sourceFiles, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: false,
    noEmit: true,
    skipLibCheck: true,
  });
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): boolean {
    if (stack.includes(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      const display = cycle.map((p) => filePathMap.get(p) ?? p).join(" -> ");
      violations.push({
        gate: EFFECT_GATES.layerCircularity,
        severity: "error",
        message: `Circular module dependency detected: ${display}`,
        location: filePathMap.get(node),
      });
      return true;
    }
    if (visited.has(node)) return false;
    visited.add(node);
    stack.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (neighbor.startsWith("__external:")) continue;
      dfs(neighbor);
    }
    stack.pop();
    return false;
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  return violations;
}

/** Heuristic: detect exported classes that look like services but don't reference Effect Tag/Layer. */
function scanMissingServiceTags(
  sourceFile: ts.SourceFile,
  filePath: string,
  thresholds: EffectGatesThresholds
): EffectGatesViolation[] {
  if (!thresholds.serviceTagRequired || thresholds.domainPurityLevel === "off") return [];

  const violations: EffectGatesViolation[] = [];
  const text = sourceFile.text;
  const hasEffectImports = /from\s+["']effect["']/.test(text);
  const hasLayerOrTag = /\b(Layer|Tag)\./.test(text);

  if (!hasEffectImports || hasLayerOrTag) return [];

  function extendsErrorOrTaggedError(node: ts.ClassDeclaration): boolean {
    if (!node.heritageClauses) return false;
    for (const clause of node.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      const heritageText = clause.types.map((t) => t.getText(sourceFile)).join(" ");
      if (/\bError\b/.test(heritageText) || /TaggedError/.test(heritageText)) return true;
    }
    return false;
  }

  function hasServiceTagExemption(node: ts.ClassDeclaration): boolean {
    const tags = ts.getJSDocTags(node);
    for (const tag of tags) {
      if (tag.tagName.text === "effect-gates-exempt-service-tag") return true;
    }
    // Fallback: check the raw source text immediately preceding the class keyword.
    const leading = sourceFile.text.slice(0, node.getStart(sourceFile));
    return /@effect-gates-exempt-service-tag\b/.test(leading);
  }

  sourceFile.forEachChild((node) => {
    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      !extendsErrorOrTaggedError(node) &&
      !hasServiceTagExemption(node)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      violations.push({
        gate: EFFECT_GATES.missingServiceTag,
        severity: thresholds.domainPurityLevel === "strict" ? "error" : "warn",
        message: `Exported service class "${node.name.text}" does not appear to use Effect Tag or Layer`,
        location: formatLocation(filePath, line),
      });
    }
  });

  return violations;
}

/** Detect impure platform API usage in domain files when domain purity is enabled. */
function scanDomainPurity(
  sourceFile: ts.SourceFile,
  filePath: string,
  thresholds: EffectGatesThresholds
): EffectGatesViolation[] {
  if (thresholds.domainPurityLevel === "off") return [];
  if (!filePath.startsWith("src/domain/")) return [];

  const violations: EffectGatesViolation[] = [];
  const text = sourceFile.text;
  const impurePatterns = [
    { regex: /\bprocess\.env\b/g, label: "process environment access" }, // @bun-native-exempt gate pattern catalog
    { regex: /\bBun\.env\b/g, label: "Bun.env access" },
    {
      regex: /\bfs\b|\bchild_process\b|\bnode:fs\b|\bnode:child_process\b/g,
      label: "platform module usage",
    },
  ];

  for (const { regex, label } of impurePatterns) {
    for (const match of text.matchAll(regex)) {
      const pos = match.index ?? 0;
      if (isTokenInCommentOrString(sourceFile, pos)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
      violations.push({
        gate: EFFECT_GATES.domainPurity,
        severity: thresholds.domainPurityLevel === "strict" ? "error" : "warn",
        message: `Possible purity violation: ${label}`,
        location: formatLocation(filePath, line),
      });
    }
  }

  return violations;
}

/** Build a TypeScript program from the discovered source files. */
function createTypeScriptProgram(filePaths: string[]): ts.Program {
  return ts.createProgram(filePaths, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: false,
    noEmit: true,
    skipLibCheck: true,
  });
}

/** Aggregate counts from violations. */
function aggregateCounts(violations: EffectGatesViolation[]): EffectGatesCounts {
  return {
    directPromise: violations.filter((v) => v.gate === EFFECT_GATES.directPromise).length,
    layerCircularity: violations.filter((v) => v.gate === EFFECT_GATES.layerCircularity).length,
    missingServiceTag: violations.filter((v) => v.gate === EFFECT_GATES.missingServiceTag).length,
    domainPurity: violations.filter((v) => v.gate === EFFECT_GATES.domainPurity).length,
    runPromiseBoundary: violations.filter((v) => v.gate === EFFECT_GATES.runPromiseBoundary).length,
    eventStream: violations.filter((v) => v.gate === EFFECT_GATES.eventStream).length,
    consoleBoundary: violations.filter((v) => v.gate === EFFECT_GATES.consoleBoundary).length,
    processEnvBoundary: violations.filter((v) => v.gate === EFFECT_GATES.processEnvBoundary).length,
    nodeFsPlugin: violations.filter((v) => v.gate === EFFECT_GATES.nodeFsPlugin).length,
  };
}

/** Compare counts and emit regression violations. */
export function detectRegressions(
  current: EffectGatesReport,
  previous: EffectGatesReport | null
): EffectGatesViolation[] {
  if (!previous) return [];
  const regressions: EffectGatesViolation[] = [];
  const keys = Object.keys(current.counts) as Array<keyof EffectGatesCounts>;

  for (const key of keys) {
    const before = previous.counts[key] ?? 0;
    const after = current.counts[key] ?? 0;
    if (after > before) {
      regressions.push({
        gate: EFFECT_GATES[key],
        severity: "error",
        message: `Regression: ${EFFECT_GATES[key]} count increased from ${before} to ${after}`,
      });
    }
  }

  return regressions;
}

/** Build a complete Effect discipline report. */
export async function buildEffectGatesReport(
  options: BuildEffectGatesReportOptions
): Promise<EffectGatesReport> {
  const projectRoot = resolve(options.projectRoot);
  const thresholds = { ...loadThresholds(), ...options.thresholdOverrides };
  const sourceFilePaths = await resolveSourceFiles(projectRoot, options.include, options.exclude);
  const program = createTypeScriptProgram(sourceFilePaths);
  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && sourceFilePaths.includes(sf.fileName));

  const filePathMap = new Map<string, string>();
  for (const sf of sourceFiles) {
    filePathMap.set(sf.fileName, relative(projectRoot, sf.fileName));
  }

  const violations: EffectGatesViolation[] = [];
  for (const sourceFile of sourceFiles) {
    const filePath = filePathMap.get(sourceFile.fileName) ?? sourceFile.fileName;
    violations.push(...scanDirectPromises(sourceFile, filePath));
    violations.push(...scanRunPromiseBoundary(sourceFile, filePath, thresholds));
    violations.push(...scanConsoleBoundary(sourceFile, filePath));
    violations.push(...scanProcessEnvBoundary(sourceFile, filePath));
    violations.push(...scanNodeFsInPlugin(sourceFile, filePath));
    violations.push(...scanMissingServiceTags(sourceFile, filePath, thresholds));
    violations.push(...scanDomainPurity(sourceFile, filePath, thresholds));
    violations.push(...scanEventStreams(sourceFile, filePath, thresholds));
  }

  violations.push(...scanLayerCircularity(sourceFiles, filePathMap, thresholds));

  const counts = aggregateCounts(violations);
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warn").length;

  // Apply max-direct-promise threshold: if the count is within tolerance, downgrade errors to warnings.
  if (counts.directPromise <= thresholds.maxDirectPromise && thresholds.maxDirectPromise > 0) {
    for (const v of violations) {
      if (v.gate === EFFECT_GATES.directPromise) v.severity = "warn";
    }
  }

  return {
    schemaVersion: EFFECT_GATES_REPORT_SCHEMA_VERSION,
    tool: options.tool ?? "kimi-effect-gates",
    generatedAt: new Date().toISOString(),
    project: await getProjectName(projectRoot),
    gitHead: options.gitHead,
    thresholds,
    counts,
    summary: {
      total: violations.length,
      errors,
      warnings,
    },
    violations,
  };
}

/** Append a report snapshot to the project's effect-gates.ndjson log. */
export async function appendEffectGatesSnapshot(
  projectRoot: string,
  report: EffectGatesReport
): Promise<void> {
  const path = effectGatesPath(projectRoot);
  makeDir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(report)}\n`, {
    create: true,
    append: true,
  } as Parameters<typeof Bun.write>[2]);
}

/** Read recent effect-gates snapshots, newest first. */
export async function readEffectGatesSnapshots(
  projectRoot: string,
  limit = 10
): Promise<EffectGatesReport[]> {
  const path = effectGatesPath(projectRoot);
  const file = Bun.file(path);
  if (!(await file.exists())) return [];

  const text = await file.text();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, limit);

  return lines
    .map((line) => safeParse<EffectGatesReport>(line, null as unknown as EffectGatesReport))
    .filter((r): r is EffectGatesReport => r !== null && typeof r === "object");
}

/** Map effect-gates snapshot history to session-floor progress counts. */
export function deriveSessionCountsFromSnapshots(
  snapshots: readonly EffectGatesReport[]
): SessionFloorCounts | null {
  if (snapshots.length === 0) return null;

  const newest = snapshots[0];
  const oldest = snapshots[snapshots.length - 1];
  const improved = (before: number, after: number) => Math.max(0, before - after);

  return {
    rawPromisesRemoved: improved(oldest.counts.directPromise, newest.counts.directPromise),
    servicesMigratedToTagLayer: improved(
      oldest.counts.missingServiceTag,
      newest.counts.missingServiceTag
    ),
    domainPurityViolationsResolved: improved(
      oldest.counts.domainPurity,
      newest.counts.domainPurity
    ),
    rawErrorsConvertedToTyped: improved(
      oldest.counts.runPromiseBoundary,
      newest.counts.runPromiseBoundary
    ),
    eventEmittersConvertedToStreams: improved(oldest.counts.eventStream, newest.counts.eventStream),
    circularLayerDependencies: newest.counts.layerCircularity,
  };
}

/** Required session-floor counts and their hardcoded minimums. */
export interface SessionFloorCounts {
  rawPromisesRemoved: number;
  servicesMigratedToTagLayer: number;
  domainPurityViolationsResolved: number;
  rawErrorsConvertedToTyped: number;
  eventEmittersConvertedToStreams: number;
  circularLayerDependencies: number;
}

/** Result of evaluating a session floor. */
export interface SessionFloorResult {
  passed: boolean;
  missing: string[];
  below: string[];
  details: Array<{ field: keyof SessionFloorCounts; actual: number; floor: number }>;
}

const SESSION_FLOOR_MINIMUMS: Record<keyof SessionFloorCounts, number> = {
  rawPromisesRemoved: 2,
  servicesMigratedToTagLayer: 2,
  domainPurityViolationsResolved: 1,
  rawErrorsConvertedToTyped: 1,
  eventEmittersConvertedToStreams: 0,
  circularLayerDependencies: 0,
};

/**
 * Evaluate whether a session's Effect-discipline counts meet the hardcoded floor.
 *
 * Missing or undefined fields are failures. Negative values are failures. Values
 * below the floor are failures. Zero-tolerance fields (event emitters, circular
 * layers) fail only when below zero, i.e., when the supplied count is negative.
 */
export function evaluateSessionFloor(counts: Partial<SessionFloorCounts>): SessionFloorResult {
  const missing: string[] = [];
  const below: string[] = [];
  const details: SessionFloorResult["details"] = [];
  let passed = true;

  for (const field of Object.keys(SESSION_FLOOR_MINIMUMS) as Array<keyof SessionFloorCounts>) {
    const raw = counts[field];
    const floor = SESSION_FLOOR_MINIMUMS[field];
    if (raw === undefined || raw === null || Number.isNaN(raw)) {
      missing.push(field);
      details.push({ field, actual: NaN, floor });
      passed = false;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      missing.push(field);
      details.push({ field, actual: raw, floor });
      passed = false;
      continue;
    }
    details.push({ field, actual: raw, floor });
    if (raw < floor) {
      below.push(field);
      passed = false;
    }
  }

  return { passed, missing, below, details };
}
