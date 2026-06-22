/**
 * Template policy audit — install parity, tsconfig contract, bun-native, typecheck.
 */

import { join } from "path";
import { absoluteScanOpts, GLOBS, repoRoot } from "./globs.ts";
import {
  evaluateViolations,
  scanGlobPatterns,
  type BunNativeLintConfig,
  type Violation,
} from "./bun-native-lint.ts";
import { readableStreamToText } from "./bun-utils.ts";

export interface TemplatePolicyViolation {
  file: string;
  field: string;
  message: string;
}

export interface TemplatePolicySummary {
  bunfigFiles: number;
  templatePackages: number;
  tsconfigProjects: number;
  templateTsFiles: number;
  registryEntries: number;
  testProjects: number;
  moduleTsFiles: number;
}

export interface TemplatePolicyAuditResult {
  violations: TemplatePolicyViolation[];
  summary: TemplatePolicySummary;
}

const REQUIRED_INSTALL_FIELDS = [
  { key: "trustedDependencies", pattern: /trustedDependencies\s*=\s*\[\]/ },
  { key: "ignoreScripts", pattern: /ignoreScripts\s*=\s*false/ },
  { key: "frozenLockfile", pattern: /frozenLockfile\s*=\s*true/ },
  { key: "linker", pattern: /linker\s*=\s*"isolated"/ },
  { key: "minimumReleaseAge", pattern: /minimumReleaseAge\s*=\s*259200/ },
] as const;

const TEMPLATE_TS_GLOBS = ["templates/**/*.ts", "templates/**/*.tsx"] as const;

const TEMPLATE_BUN_NATIVE_EXEMPT = ["templates/scaffold/scripts/lib/bun-io.ts"] as const;

const REQUIRED_TSCONFIG: Record<string, unknown> = {
  strict: true,
  noEmit: true,
  moduleResolution: "bundler",
  types: ["bun"],
};

const BUN_CREATE_DIR = "templates/bun-create";
const REGISTRY_PATH = `${BUN_CREATE_DIR}/templates.json`;
const MODULES_TSCONFIG = "templates/modules/tsconfig.json";

const ENTRY_SHEBANG_GLOBS = [
  "templates/**/src/bin/*.ts",
  "templates/**/scripts/postinstall.ts",
  "templates/modules/**/src/bin/*.ts",
] as const;

const BUN_SHEBANG = "#!/usr/bin/env bun";

export function templateBunNativeConfig(): BunNativeLintConfig {
  return {
    schemaVersion: 1,
    gateMode: "check",
    rules: {
      "banned-import": "enforce",
      "banned-require": "enforce",
      "process-env": "enforce",
      "sync-fs-api": "enforce",
      "sleep-settimeout": "enforce",
      "process-argv": "enforce",
      "response-stream-text": "enforce",
      "stringify-stdout": "off",
      "spawn-no-orphans": "enforce",
    },
    exemptFiles: [...TEMPLATE_BUN_NATIVE_EXEMPT],
  };
}

function collectTemplateBunfigs(root: string): string[] {
  const scanOpts = absoluteScanOpts(root);
  return [
    ...GLOBS.scaffoldBunfig.scanSync(scanOpts),
    ...GLOBS.templateBunfig.scanSync(scanOpts),
  ].sort();
}

function countTemplatePackages(root: string): number {
  const templatePkgGlob = new Bun.Glob("templates/bun-create/*/package.json");
  return [...templatePkgGlob.scanSync({ cwd: root, absolute: true, onlyFiles: true })].length;
}

function collectTemplateTsconfigs(root: string): string[] {
  const modulesConfig = join(root, MODULES_TSCONFIG);
  const glob = new Bun.Glob("templates/**/tsconfig.json");
  return [...glob.scanSync({ cwd: root, absolute: true, onlyFiles: true })]
    .filter((path) => path !== modulesConfig)
    .sort();
}

function rel(root: string, abs: string): string {
  return abs.startsWith(root) ? abs.slice(root.length + 1) : abs;
}

function violationToPolicy(v: Violation): TemplatePolicyViolation {
  return {
    file: v.file,
    field: v.ruleId,
    message: `${v.message} (line ${v.line}) — use ${v.replacement}`,
  };
}

async function auditCliArgvPolicy(root: string): Promise<TemplatePolicyViolation[]> {
  const glob = new Bun.Glob("templates/**/{src/bin,scripts}/**/*.ts");
  const violations: TemplatePolicyViolation[] = [];
  for (const path of glob.scanSync({ cwd: root, absolute: true, onlyFiles: true })) {
    const text = await Bun.file(path).text();
    const relPath = rel(root, path);
    for (const [i, line] of text.split("\n").entries()) {
      if (line.trim().startsWith("//") || line.includes("@bun-native-exempt")) continue;
      if (!/\bprocess\.argv\b/.test(line)) continue;
      violations.push({
        file: relPath,
        field: "process-argv",
        message: `process.argv in template CLI/script (line ${i + 1}) — use Bun.argv`,
      });
    }
  }
  return violations;
}

export async function auditTemplateInstallPolicy(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const templates = collectTemplateBunfigs(root);

  const pkgPath = join(root, "package.json");
  const pkg = (await Bun.file(pkgPath).json()) as { trustedDependencies?: unknown };
  if (!("trustedDependencies" in pkg)) {
    violations.push({
      file: pkgPath,
      field: "trustedDependencies",
      message: "Root package.json missing explicit trustedDependencies field",
    });
  } else if (!Array.isArray(pkg.trustedDependencies)) {
    violations.push({
      file: pkgPath,
      field: "trustedDependencies",
      message: "Root package.json trustedDependencies must be an array",
    });
  }

  const templatePkgGlob = new Bun.Glob("templates/bun-create/*/package.json");
  for (const path of templatePkgGlob.scanSync({ cwd: root, absolute: true, onlyFiles: true })) {
    const templatePkg = (await Bun.file(path).json()) as { trustedDependencies?: unknown };
    if (!("trustedDependencies" in templatePkg)) {
      violations.push({
        file: rel(root, path),
        field: "trustedDependencies",
        message: "Template package.json missing explicit trustedDependencies field",
      });
    } else if (!Array.isArray(templatePkg.trustedDependencies)) {
      violations.push({
        file: rel(root, path),
        field: "trustedDependencies",
        message: "Template package.json trustedDependencies must be an array",
      });
    }
  }

  if (templates.length === 0) {
    violations.push({
      file: "templates/",
      field: "[install]",
      message: "No template bunfig.toml files found",
    });
    return violations;
  }

  for (const path of templates) {
    const text = await Bun.file(path).text();
    const relPath = rel(root, path);
    const installMatch = text.match(/\[install\][\s\S]*?(?=\n\[|$)/);
    if (!installMatch) {
      violations.push({
        file: relPath,
        field: "[install]",
        message: "Missing [install] section",
      });
      continue;
    }
    const installBlock = installMatch[0];
    for (const { key, pattern } of REQUIRED_INSTALL_FIELDS) {
      if (!pattern.test(installBlock)) {
        violations.push({
          file: relPath,
          field: key,
          message: `Missing or misaligned [install] field: ${key}`,
        });
      }
    }
  }

  return violations;
}

export async function auditTemplateTsconfigs(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const path of collectTemplateTsconfigs(root)) {
    const relPath = rel(root, path);
    let parsed: { compilerOptions?: Record<string, unknown>; include?: string[] };
    try {
      parsed = (await Bun.file(path).json()) as {
        compilerOptions?: Record<string, unknown>;
        include?: string[];
      };
    } catch {
      violations.push({
        file: relPath,
        field: "tsconfig",
        message: "Invalid tsconfig.json",
      });
      continue;
    }

    const opts = parsed.compilerOptions ?? {};
    for (const [key, expected] of Object.entries(REQUIRED_TSCONFIG)) {
      const actual = opts[key];
      if (key === "types") {
        const types = Array.isArray(actual) ? actual : [];
        if (!types.includes("bun")) {
          violations.push({
            file: relPath,
            field: "compilerOptions.types",
            message: 'tsconfig must include "bun" in compilerOptions.types',
          });
        }
        continue;
      }
      if (actual !== expected) {
        violations.push({
          file: relPath,
          field: `compilerOptions.${key}`,
          message: `Expected compilerOptions.${key} = ${JSON.stringify(expected)}`,
        });
      }
    }

    if (!parsed.include?.length) {
      violations.push({
        file: relPath,
        field: "include",
        message: "tsconfig.json must declare include paths",
      });
    }
  }
  return violations;
}

export async function auditTemplateBunNative(root: string): Promise<TemplatePolicyViolation[]> {
  const config = templateBunNativeConfig();
  const violations = await scanGlobPatterns(root, [...TEMPLATE_TS_GLOBS], config);
  const evaluated = evaluateViolations(violations, config, null);
  const policy = evaluated.enforceViolations.map(violationToPolicy);
  return [...policy, ...(await auditCliArgvPolicy(root))];
}

interface TemplateRegistryEntry {
  name: string;
  path?: string;
}

interface TemplateRegistry {
  templates: TemplateRegistryEntry[];
}

function templateDir(entry: TemplateRegistryEntry): string {
  return entry.path ?? entry.name;
}

async function readTemplateRegistry(root: string): Promise<TemplateRegistry> {
  return (await Bun.file(join(root, REGISTRY_PATH)).json()) as TemplateRegistry;
}

export async function auditTemplateRegistry(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const bunCreateRoot = join(root, BUN_CREATE_DIR);
  let registry: TemplateRegistry;
  try {
    registry = await readTemplateRegistry(root);
  } catch {
    violations.push({
      file: REGISTRY_PATH,
      field: "registry",
      message: "Failed to read templates.json",
    });
    return violations;
  }

  const packages = [...new Bun.Glob("*/package.json").scanSync({
    cwd: bunCreateRoot,
    absolute: true,
    onlyFiles: true,
  })];
  const registryPaths = new Set(registry.templates.map(templateDir));
  const packageDirs = new Set(
    packages.map((p) => p.slice(bunCreateRoot.length + 1).replace("/package.json", ""))
  );

  for (const path of packages) {
    const relPath = rel(root, path);
    const pkg = (await Bun.file(path).json()) as {
      type?: string;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      scripts?: { postinstall?: string; typecheck?: string };
      "bun-create"?: { postinstall?: string[] };
    };

    if (pkg.type !== "module") {
      violations.push({
        file: relPath,
        field: "type",
        message: 'package.json must declare "type": "module"',
      });
    }

    const depCount =
      Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (depCount > 0) {
      violations.push({
        file: relPath,
        field: "dependencies",
        message: `has ${depCount} dependencies (bun-create templates must be zero-deps)`,
      });
    }

    const hasPostinstall =
      typeof pkg.scripts?.postinstall === "string" || Array.isArray(pkg["bun-create"]?.postinstall);
    if (!hasPostinstall) {
      violations.push({
        file: relPath,
        field: "postinstall",
        message: "missing postinstall script",
      });
    }

    const projectDir = join(path, "..");
    const hasTsconfig = await Bun.file(join(projectDir, "tsconfig.json")).exists();
    if (hasTsconfig && typeof pkg.scripts?.typecheck !== "string") {
      violations.push({
        file: relPath,
        field: "scripts.typecheck",
        message: 'tsconfig present — add "typecheck": "tsc --noEmit"',
      });
    }
  }

  for (const entry of registry.templates) {
    const dir = templateDir(entry);
    if (!packageDirs.has(dir)) {
      violations.push({
        file: REGISTRY_PATH,
        field: "registry",
        message: `Registry entry "${entry.name}" references missing directory: ${dir}`,
      });
    }
  }

  for (const dir of packageDirs) {
    if (!registryPaths.has(dir)) {
      violations.push({
        file: REGISTRY_PATH,
        field: "registry",
        message: `Template directory not in registry: ${dir}`,
      });
    }
  }

  return violations;
}

export async function auditTemplateBunfigRuntime(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const path of collectTemplateBunfigs(root)) {
    const text = await Bun.file(path).text();
    const relPath = rel(root, path);
    if (!/\[run\][\s\S]*?noOrphans\s*=\s*true/.test(text)) {
      violations.push({
        file: relPath,
        field: "[run].noOrphans",
        message: "Missing [run] noOrphans = true (orphan-process hygiene)",
      });
    }
    const projectDir = dirnameForBunfig(path);
    const hasTests = [...new Bun.Glob("test/**/*.test.ts").scanSync({
      cwd: projectDir,
      onlyFiles: true,
    })].length;
    if (hasTests > 0 && !/\[test\]/.test(text)) {
      violations.push({
        file: relPath,
        field: "[test]",
        message: "Template has tests but bunfig.toml missing [test] section",
      });
    }
  }
  return violations;
}

function dirnameForBunfig(bunfigPath: string): string {
  return join(bunfigPath, "..");
}

export async function auditTemplateEntryShebangs(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const seen = new Set<string>();
  for (const pattern of ENTRY_SHEBANG_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    })) {
      if (seen.has(path)) continue;
      seen.add(path);
      const firstLine = (await Bun.file(path).text()).split("\n")[0]?.trim() ?? "";
      if (firstLine === BUN_SHEBANG) continue;
      violations.push({
        file: rel(root, path),
        field: "shebang",
        message: `Missing ${BUN_SHEBANG} on executable entry`,
      });
    }
  }
  return violations;
}

export async function auditTemplateModulesTypecheck(root: string): Promise<TemplatePolicyViolation[]> {
  const tsconfigPath = join(root, MODULES_TSCONFIG);
  if (!(await Bun.file(tsconfigPath).exists())) {
    return [
      {
        file: MODULES_TSCONFIG,
        field: "tsconfig",
        message: "Missing templates/modules/tsconfig.json for module slice typecheck",
      },
    ];
  }
  const proc = Bun.spawn({
    cmd: ["bunx", "tsc", "--noEmit", "-p", tsconfigPath],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit === 0) return [];
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const detail = (err || out).trim().split("\n").slice(0, 4).join(" · ");
  return [
    {
      file: MODULES_TSCONFIG,
      field: "typecheck",
      message: detail || `modules tsc failed (exit ${exit})`,
    },
  ];
}

function collectTemplateTestProjects(root: string): string[] {
  const projects = new Set<string>();
  for (const testFile of new Bun.Glob("templates/**/test/**/*.test.ts").scanSync({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    const testDir = join(testFile, "..", "..");
    projects.add(testDir);
  }
  return [...projects].sort();
}

export async function auditTemplateTests(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const projectDir of collectTemplateTestProjects(root)) {
    const relProject = rel(root, projectDir);
    const proc = Bun.spawn({
      cmd: ["bun", "test", "--parallel", "--isolate"],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit === 0) continue;
    const out = await readableStreamToText(proc.stdout);
    const err = await readableStreamToText(proc.stderr);
    const detail = (err || out).trim().split("\n").slice(-4).join(" · ");
    violations.push({
      file: relProject,
      field: "bun-test",
      message: detail || `bun test failed (exit ${exit})`,
    });
  }
  return violations;
}

export async function auditTemplateTypecheck(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const tsconfigPath of collectTemplateTsconfigs(root)) {
    const projectDir = join(tsconfigPath, "..");
    const relPath = rel(root, tsconfigPath);
    const proc = Bun.spawn({
      cmd: ["bunx", "tsc", "--noEmit", "-p", tsconfigPath],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit === 0) continue;
    const out = await readableStreamToText(proc.stdout);
    const err = await readableStreamToText(proc.stderr);
    const detail = (err || out).trim().split("\n").slice(0, 4).join(" · ");
    violations.push({
      file: relPath,
      field: "typecheck",
      message: detail || `tsc --noEmit failed (exit ${exit})`,
    });
  }
  return violations;
}

async function countTemplateTsFiles(root: string): Promise<number> {
  const skipDirs = new Set(["node_modules", ".git", "coverage"]);
  const seen = new Set<string>();
  for (const pattern of TEMPLATE_TS_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      if (rel.split("/").some((seg) => skipDirs.has(seg))) continue;
      seen.add(rel);
    }
  }
  return seen.size;
}

async function countModuleTsFiles(root: string): Promise<number> {
  const glob = new Bun.Glob("templates/modules/**/*.ts");
  let count = 0;
  for await (const _rel of glob.scan({ cwd: root, onlyFiles: true })) count++;
  return count;
}

async function registryEntryCount(root: string): Promise<number> {
  try {
    const registry = await readTemplateRegistry(root);
    return registry.templates.length;
  } catch {
    return 0;
  }
}

export async function auditTemplatePolicy(root: string): Promise<TemplatePolicyAuditResult> {
  const tsconfigs = collectTemplateTsconfigs(root);
  const violations = [
    ...(await auditTemplateInstallPolicy(root)),
    ...(await auditTemplateRegistry(root)),
    ...(await auditTemplateBunfigRuntime(root)),
    ...(await auditTemplateTsconfigs(root)),
    ...(await auditTemplateEntryShebangs(root)),
    ...(await auditTemplateBunNative(root)),
    ...(await auditTemplateTypecheck(root)),
    ...(await auditTemplateModulesTypecheck(root)),
    ...(await auditTemplateTests(root)),
  ];

  return {
    violations,
    summary: {
      bunfigFiles: collectTemplateBunfigs(root).length,
      templatePackages: countTemplatePackages(root),
      tsconfigProjects: tsconfigs.length,
      templateTsFiles: await countTemplateTsFiles(root),
      registryEntries: await registryEntryCount(root),
      testProjects: collectTemplateTestProjects(root).length,
      moduleTsFiles: await countModuleTsFiles(root),
    },
  };
}

export async function templatePolicyDryRunSummary(root: string): Promise<TemplatePolicySummary> {
  return {
    bunfigFiles: collectTemplateBunfigs(root).length,
    templatePackages: countTemplatePackages(root),
    tsconfigProjects: collectTemplateTsconfigs(root).length,
    templateTsFiles: 0,
    registryEntries: await registryEntryCount(root),
    testProjects: collectTemplateTestProjects(root).length,
    moduleTsFiles: await countModuleTsFiles(root),
  };
}

export function defaultTemplatePolicyRoot(): string {
  return repoRoot(".");
}
