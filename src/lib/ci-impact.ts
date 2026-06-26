import { dirname, join, relative } from "path";
import { INTEGRATION_TEST_FILES, SMOKE_TEST_FILES, UNIT_TEST_FILES } from "./test-gates.ts";

export type ChangeType = "docs" | "config" | "source";

export interface ImpactBenchmark {
  id: string;
  paths: string[];
}

export interface ImpactTarget {
  id: string;
  paths: string[];
  tests?: string[];
  integrationTests?: string[];
  smoke?: boolean;
}

export interface ImpactConfig {
  version: 1;
  description?: string;
  notes?: string[];
  docsOnly: string[];
  configOnly?: string[];
  fullRun: string[];
  risky: string[];
  security: string[];
  benchmarks: ImpactBenchmark[];
  targets: ImpactTarget[];
}

export interface ImpactResult {
  changedFiles: string[];
  changeType: ChangeType;
  docsOnly: boolean;
  fullRequired: boolean;
  fullReason: string | null;
  affectedFiles: string[];
  unmatchedRiskyFiles: string[];
  unitTests: string[];
  integrationTests: string[];
  smokeRequired: boolean;
  benchmarkIds: string[];
  securityRequired: boolean;
  matrix: Array<{ gate: string }>;
}

export interface ModuleGraph {
  dependencies: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
}

const sourceGates = ["quality", "success-metrics", "governance"];
const minimalGates = ["success-metrics", "governance"];

export function analyzeImpact(
  config: ImpactConfig,
  changedFiles: string[],
  graph?: ModuleGraph
): ImpactResult {
  const files = changedFiles.map(normalizePath).filter(Boolean);
  const fullReason = findFullReason(config, files);
  const fullRequired = fullReason !== null;
  const docsOnly =
    files.length > 0 && files.every((file) => matchesAny(config.docsOnly, file)) && !fullRequired;
  const configOnly =
    files.length > 0 &&
    files.every((file) => matchesAny(config.configOnly ?? [], file)) &&
    !fullRequired &&
    !docsOnly;
  const unitTests = new Set<string>();
  const integrationTests = new Set<string>();
  const benchmarkIds = new Set<string>();
  const unmatchedRiskyFiles = new Set<string>();
  let smokeRequired = false;
  let securityRequired =
    !docsOnly &&
    !configOnly &&
    (fullRequired || files.some((file) => matchesAny(config.security, file)));
  const affectedFiles = graph ? collectAffectedFiles(graph, files) : new Set(files);

  for (const file of files) {
    if (fullRequired || docsOnly || configOnly) continue;

    let matchedTarget = false;
    for (const target of config.targets) {
      if (!matchesAny(target.paths, file)) continue;
      matchedTarget = true;
      for (const test of target.tests ?? []) unitTests.add(test);
      for (const test of target.integrationTests ?? []) integrationTests.add(test);
      smokeRequired ||= target.smoke === true;
    }

    for (const benchmark of config.benchmarks) {
      if (matchesAny(benchmark.paths, file)) benchmarkIds.add(benchmark.id);
    }

    const selectedByGraph = selectFromAffected(config, collectAffectedFiles(graph, [file]), {
      unitTests,
      integrationTests,
      benchmarkIds,
      smokeRequired,
    });
    smokeRequired ||= selectedByGraph.smokeRequired;

    if (!matchedTarget && !selectedByGraph.selected && matchesAny(config.risky, file)) {
      unmatchedRiskyFiles.add(file);
    }
  }

  const graphSelection = selectFromAffected(config, affectedFiles, {
    unitTests,
    integrationTests,
    benchmarkIds,
    smokeRequired,
  });
  smokeRequired ||= graphSelection.smokeRequired;

  const unknownRiskForcesFull = unmatchedRiskyFiles.size > 0;
  const effectiveFull = fullRequired || unknownRiskForcesFull;
  const effectiveDocsOnly = docsOnly && !effectiveFull;
  const changeType = effectiveFull
    ? "source"
    : effectiveDocsOnly
      ? "docs"
      : configOnly
        ? "config"
        : "source";
  const allBenchmarkIds = config.benchmarks.map((benchmark) => benchmark.id);
  const result: ImpactResult = {
    changedFiles: files,
    changeType,
    docsOnly: effectiveDocsOnly,
    fullRequired: effectiveFull,
    fullReason: fullReason ?? (unknownRiskForcesFull ? "unmatched risky files" : null),
    affectedFiles: Array.from(affectedFiles).sort(),
    unmatchedRiskyFiles: Array.from(unmatchedRiskyFiles).sort(),
    unitTests: effectiveFull ? [...UNIT_TEST_FILES] : Array.from(unitTests).sort(),
    integrationTests: effectiveFull
      ? [...INTEGRATION_TEST_FILES]
      : Array.from(integrationTests).sort(),
    smokeRequired: effectiveFull || smokeRequired,
    benchmarkIds: effectiveFull ? allBenchmarkIds : Array.from(benchmarkIds).sort(),
    securityRequired: effectiveFull || securityRequired,
    matrix: [],
  };
  result.matrix = buildMatrix(result);
  return result;
}

export async function buildModuleGraph(repoRoot: string, files: string[]): Promise<ModuleGraph> {
  const fileSet = new Set(files.map(normalizePath));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const file of fileSet) {
    if (!isGraphFile(file)) continue;
    const imports = await readImports(repoRoot, file);
    const resolved = new Set<string>();
    for (const specifier of imports) {
      const dep = resolveImport(file, specifier, fileSet);
      if (!dep) continue;
      resolved.add(dep);
      const reverse = dependents.get(dep) ?? new Set<string>();
      reverse.add(file);
      dependents.set(dep, reverse);
    }
    dependencies.set(file, resolved);
  }

  return { dependencies, dependents };
}

export function collectAffectedFiles(
  graph: ModuleGraph | undefined,
  changedFiles: string[]
): Set<string> {
  const affected = new Set(changedFiles.map(normalizePath));
  if (!graph) return affected;
  const queue = [...affected];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const dependent of graph.dependents.get(file) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      queue.push(dependent);
    }
  }
  return affected;
}

export function parseImportSpecifiers(source: string): string[] {
  const imports = new Set<string>();
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) imports.add(specifier);
  }
  return Array.from(imports);
}

export function resolveImport(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(join(dirname(fromFile), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ].map(normalizePath);
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function buildMatrix(result: ImpactResult): Array<{ gate: string }> {
  const sourceLike = result.fullRequired || result.changeType === "source";
  const gates = new Set(sourceLike ? sourceGates : minimalGates);
  if (sourceLike) gates.add("typecheck");
  if (sourceLike && result.unitTests.length > 0) gates.add("unit");
  if (sourceLike && result.integrationTests.length > 0) gates.add("integration");
  if (sourceLike && result.smokeRequired) gates.add("smoke");
  if (sourceLike && result.benchmarkIds.length > 0) gates.add("benchmark");
  if (result.securityRequired) gates.add("security");
  return Array.from(gates).map((gate) => ({ gate }));
}

function selectFromAffected(
  config: ImpactConfig,
  affectedFiles: Set<string>,
  current: {
    unitTests: Set<string>;
    integrationTests: Set<string>;
    benchmarkIds: Set<string>;
    smokeRequired: boolean;
  }
): { selected: boolean; smokeRequired: boolean } {
  let selected = false;
  let smokeRequired = current.smokeRequired;
  for (const file of affectedFiles) {
    if (UNIT_TEST_FILES.includes(file as (typeof UNIT_TEST_FILES)[number])) {
      current.unitTests.add(file);
      selected = true;
    }
    if (INTEGRATION_TEST_FILES.includes(file as (typeof INTEGRATION_TEST_FILES)[number])) {
      current.integrationTests.add(file);
      selected = true;
    }
    if (SMOKE_TEST_FILES.includes(file as (typeof SMOKE_TEST_FILES)[number])) {
      smokeRequired = true;
      selected = true;
    }
    for (const benchmark of config.benchmarks) {
      if (matchesAny(benchmark.paths, file)) {
        current.benchmarkIds.add(benchmark.id);
        selected = true;
      }
    }
  }
  return { selected, smokeRequired };
}

function findFullReason(config: ImpactConfig, files: string[]): string | null {
  if (Bun.env.GITHUB_EVENT_NAME === "schedule") return "scheduled full-suite run";
  const fullMatch = files.find((file) => matchesAny(config.fullRun, file));
  return fullMatch ? `full-run pattern matched: ${fullMatch}` : null;
}

export function matchesAny(patterns: string[], file: string): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      const after = pattern[i + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === undefined) continue;
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

async function readImports(repoRoot: string, file: string): Promise<string[]> {
  const text = await Bun.file(join(repoRoot, file)).text();
  return parseImportSpecifiers(text);
}

function isGraphFile(file: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs)$/.test(file);
}

export function toRepoRelative(repoRoot: string, path: string): string {
  return normalizePath(relative(repoRoot, path));
}
