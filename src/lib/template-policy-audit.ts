/**
 * Template policy audit — install parity, tsconfig contract, bun-native, typecheck.
 */

import { basename, join } from "path";
import { absoluteScanOpts, GLOBS, repoRoot } from "./globs.ts";
import {
  evaluateViolations,
  scanGlobPatterns,
  type BunNativeLintConfig,
  type Violation,
} from "./bun-native-lint.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { auditHardcodedSecretsInGlob } from "./hardcoded-secret-audit.ts";
import { auditSecretLeaksInGlob } from "../doctor/secret-audit.ts";
import { TEMPLATE_MARKERS } from "./scaffold-templates.ts";

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
  moduleSlices: number;
  scaffoldFiles: number;
  envExampleFiles: number;
}

export interface TemplatePolicyAuditResult {
  violations: TemplatePolicyViolation[];
  summary: TemplatePolicySummary;
}

const REQUIRED_INSTALL_FIELDS = [
  { key: "trustedDependencies", pattern: /trustedDependencies\s*=\s*\[\]/ },
  { key: "ignoreScripts", pattern: /ignoreScripts\s*=\s*false/ },
  { key: "frozenLockfile", pattern: /frozenLockfile\s*=\s*true/ },
  { key: "saveTextLockfile", pattern: /saveTextLockfile\s*=\s*true/ },
  { key: "linker", pattern: /linker\s*=\s*"isolated"/ },
  { key: "globalStore", pattern: /globalStore\s*=\s*true/ },
  { key: "minimumReleaseAge", pattern: /minimumReleaseAge\s*=\s*259200/ },
] as const;

const TEMPLATE_BANNED_TERMS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Tier[- ]?1380/i, label: "Tier-1380 internal tag (use global Bun-native wording)" },
];

const TEMPLATE_TEST_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:unit|integration|smoke)\.test\.ts$/;

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const SCAFFOLD_DIR = "templates/scaffold";

const REQUIRED_SCAFFOLD_FILES = [
  "bunfig.toml",
  "tsconfig.json",
  "index.ts",
  "README.md",
  "oxfmtrc.json",
  "oxlintrc.json",
  "env.example",
  "gitignore",
  "ci.yml",
  "bun-globals.d.ts",
  "code-references.md",
  "adr-template.md",
  "LICENSE-MIT",
  "dx.config.toml",
] as const;

const SCAFFOLD_MARKER_FILES: Record<keyof typeof TEMPLATE_MARKERS, string> = {
  OXFMTRC: "oxfmtrc.json",
  CI_WORKFLOW: "ci.yml",
  TSCONFIG: "tsconfig.json",
  BUNFIG: "bunfig.toml",
  GITIGNORE: "gitignore",
  ENV_EXAMPLE: "env.example",
};

const REGISTRY_REQUIRED_ENTRY_FIELDS = ["name", "type", "purpose"] as const;

const BUN_CREATE_README = "templates/bun-create/README.md";
const TEMPLATES_FAMILY_README = "templates/README.md";
const MODULES_DIR = "templates/modules";

const REQUIRED_SCAFFOLD_TOOLCHAIN_FILES = [
  "dx.config.app.toml",
  "dx.config.toolchain.toml",
  "scripts/finish-work.ts",
  "scripts/finish-work-config.ts",
  "scripts/finish-work-herdr.ts",
  "scripts/reviewer-pane.ts",
  "scripts/lib/bun-io.ts",
  "scripts/lib/bun-utils.ts",
] as const;

const MODULE_PROCESSOR_SLICES = [
  "clock",
  "db",
  "http",
  "image",
  "terminal",
  "transpiler",
  "uuid",
] as const;

const HERDR_SERVICE_TEMPLATE = "templates/bun-create/herdr-service-template";
const HERDR_SECRETS_DIR = `${HERDR_SERVICE_TEMPLATE}/src/lib/secrets`;

const HERDR_SECRETS_FILES = [
  "_registry.ts",
  "access.ts",
  "isolation.ts",
  "legacy.ts",
  "index.ts",
] as const;

const POSTINSTALL_SCRIPT_GLOB = "templates/**/scripts/postinstall.ts";

const BUN_INIT_FORBIDDEN_RE = /\bbun\s+init\b(?!.*(?:-m|--minimal))/;

const ENV_EXAMPLE_REQUIRED_MARKERS = ["Never commit .env"] as const;

const KIMI_NEW_ENTRY = "src/bin/kimi-new.ts";
const POSTINSTALL_BOOTSTRAP_MARKER = "template-bootstrap";

/** Named audit layers run by `auditTemplatePolicy` — SSOT for dry-run and docs. */
export const TEMPLATE_POLICY_CHECK_IDS = [
  "install",
  "registry",
  "registry-schema",
  "readme-registry",
  "bootstrap-docs",
  "bootstrap-bridge",
  "postinstall-bootstrap",
  "bun-init-guard",
  "secrets-slice",
  "secrets-env-docs",
  "secret-leaks",
  "bunfig-runtime",
  "tsconfig",
  "scaffold-files",
  "scaffold-toolchain",
  "scaffold-markers",
  "module-slice",
  "shebang",
  "env-hygiene",
  "env-example",
  "banned-terms",
  "hardcoded-secrets",
  "oxlint",
  "oxfmt",
  "bun-native",
  "test-conventions",
  "typecheck",
  "modules-typecheck",
  "bun-test",
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
    if (!/\[install\.cache\][\s\S]*?dir\s*=\s*"~\/\.bun\/install\/cache"/.test(text)) {
      violations.push({
        file: relPath,
        field: "[install.cache]",
        message: 'Missing [install.cache] dir = "~/.bun/install/cache"',
      });
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
  type?: string;
  purpose?: string;
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

  const packages = [
    ...new Bun.Glob("*/package.json").scanSync({
      cwd: bunCreateRoot,
      absolute: true,
      onlyFiles: true,
    }),
  ];
  const registryPaths = new Set(registry.templates.map(templateDir));
  const packageDirs = new Set(
    packages.map((p) => p.slice(bunCreateRoot.length + 1).replace("/package.json", ""))
  );

  for (const path of packages) {
    const relPath = rel(root, path);
    const pkg = (await Bun.file(path).json()) as {
      name?: string;
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

    if (pkg.name !== "{{name}}") {
      violations.push({
        file: relPath,
        field: "name",
        message: 'package.json name must be "{{name}}" for bun-create placeholder substitution',
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
    const hasTests = [
      ...new Bun.Glob("test/**/*.test.ts").scanSync({
        cwd: projectDir,
        onlyFiles: true,
      }),
    ].length;
    if (hasTests > 0 && !/\[test\]/.test(text)) {
      violations.push({
        file: relPath,
        field: "[test]",
        message: "Template has tests but bunfig.toml missing [test] section",
      });
    }
    if (/\[test\]/.test(text) && !/concurrentTestGlob\s*=\s*\[/.test(text)) {
      violations.push({
        file: relPath,
        field: "[test].concurrentTestGlob",
        message: "bunfig [test] must declare concurrentTestGlob for unit tier parity",
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

export async function auditTemplateModulesTypecheck(
  root: string
): Promise<TemplatePolicyViolation[]> {
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

function parseTestStem(rel: string): string | null {
  const name = basename(rel);
  const match = name.match(/^(.+)\.(unit|integration|smoke)\.test\.ts$/);
  return match?.[1] ?? null;
}

function firstTopLevelDescribe(text: string): string | null {
  const match = text.match(/describe\s*\(\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? null;
}

export async function auditTemplateTestConventions(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const path of new Bun.Glob("templates/**/test/**/*.test.ts").scanSync({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    const relPath = rel(root, path);
    const fileName = basename(path);
    if (!TEMPLATE_TEST_FILENAME.test(fileName)) {
      violations.push({
        file: relPath,
        field: "test-filename",
        message: `Test file must match {stem}.{unit|integration|smoke}.test.ts — got ${fileName}`,
      });
      continue;
    }
    const stem = parseTestStem(fileName);
    if (!stem) continue;
    const describe = firstTopLevelDescribe(await Bun.file(path).text());
    if (!describe) {
      violations.push({
        file: relPath,
        field: "test-describe",
        message: 'Missing top-level describe("…") block',
      });
      continue;
    }
    if (!KEBAB_CASE.test(describe)) {
      violations.push({
        file: relPath,
        field: "test-describe",
        message: `Top-level describe must be kebab-case — got "${describe}"`,
      });
      continue;
    }
    if (describe !== stem && !describe.startsWith(`${stem}-`)) {
      violations.push({
        file: relPath,
        field: "test-describe",
        message: `Top-level describe must start with file stem "${stem}" — got "${describe}"`,
      });
    }
  }
  return violations;
}

export async function auditTemplateEnvHygiene(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const envGlob = new Bun.Glob("templates/**/.env");
  for (const path of envGlob.scanSync({ cwd: root, absolute: true, onlyFiles: true })) {
    violations.push({
      file: rel(root, path),
      field: "env-hygiene",
      message: "Committed .env in templates — use .env.example only",
    });
  }
  return violations;
}

export async function auditTemplateBannedTerms(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const scanGlob = new Bun.Glob("templates/**/*.{md,ts,json,toml}");
  const skipDirs = new Set(["node_modules", ".git", "coverage", ".bun"]);
  for await (const relPath of scanGlob.scan({ cwd: root, onlyFiles: true })) {
    if (relPath.split("/").some((seg) => skipDirs.has(seg))) continue;
    const text = await Bun.file(join(root, relPath)).text();
    for (const line of text.split("\n")) {
      for (const { pattern, label } of TEMPLATE_BANNED_TERMS) {
        if (!pattern.test(line)) continue;
        violations.push({
          file: relPath,
          field: "banned-term",
          message: `${label} — ${line.trim().slice(0, 100)}`,
        });
      }
    }
  }
  return violations;
}

export async function auditTemplateHardcodedSecrets(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const result = await auditHardcodedSecretsInGlob(root, [
    "templates/**/*.ts",
    "templates/**/*.tsx",
  ]);
  return result.findings.map((finding) => ({
    file: finding.file,
    field: finding.type,
    message: `line ${finding.line}: ${finding.snippet}`,
  }));
}

export async function auditTemplateScaffoldFiles(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const scaffoldRoot = join(root, SCAFFOLD_DIR);
  for (const name of REQUIRED_SCAFFOLD_FILES) {
    const path = join(scaffoldRoot, name);
    if (!(await Bun.file(path).exists())) {
      violations.push({
        file: `${SCAFFOLD_DIR}/${name}`,
        field: "scaffold-file",
        message: "Missing required scaffold template file",
      });
    }
  }
  return violations;
}

export async function auditTemplateScaffoldMarkers(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const [marker, filename] of Object.entries(SCAFFOLD_MARKER_FILES) as Array<
    [keyof typeof TEMPLATE_MARKERS, string]
  >) {
    const path = join(root, SCAFFOLD_DIR, filename);
    if (!(await Bun.file(path).exists())) continue;
    const text = await Bun.file(path).text();
    for (const needle of TEMPLATE_MARKERS[marker]) {
      if (text.includes(needle)) continue;
      violations.push({
        file: `${SCAFFOLD_DIR}/${filename}`,
        field: `scaffold-marker:${marker}`,
        message: `Missing drift marker ${JSON.stringify(needle)}`,
      });
    }
  }
  return violations;
}

export async function auditTemplateRegistrySchema(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  let registry: TemplateRegistry & { schemaVersion?: number };
  try {
    registry = (await readTemplateRegistry(root)) as TemplateRegistry & { schemaVersion?: number };
  } catch {
    return [
      {
        file: REGISTRY_PATH,
        field: "registry-schema",
        message: "Failed to read templates.json for schema audit",
      },
    ];
  }
  if (registry.schemaVersion !== 1) {
    violations.push({
      file: REGISTRY_PATH,
      field: "schemaVersion",
      message: 'templates.json must declare "schemaVersion": 1',
    });
  }
  for (const entry of registry.templates) {
    for (const field of REGISTRY_REQUIRED_ENTRY_FIELDS) {
      const value = entry[field as keyof TemplateRegistryEntry];
      if (typeof value !== "string" || value.trim().length === 0) {
        violations.push({
          file: REGISTRY_PATH,
          field: `registry.${field}`,
          message: `Registry entry "${entry.name ?? "?"}" missing required field: ${field}`,
        });
      }
    }
  }
  return violations;
}

function collectEnvExampleFiles(root: string): string[] {
  const paths = [
    ...new Bun.Glob("templates/bun-create/*/.env.example").scanSync({
      cwd: root,
      onlyFiles: true,
    }),
  ];
  const scaffoldExample = "templates/scaffold/env.example";
  if (Bun.file(join(root, scaffoldExample)).size > 0) paths.push(scaffoldExample);
  return paths.sort();
}

export async function auditTemplateScaffoldToolchain(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const scaffoldRoot = join(root, SCAFFOLD_DIR);
  for (const name of REQUIRED_SCAFFOLD_TOOLCHAIN_FILES) {
    const path = join(scaffoldRoot, name);
    if (!(await Bun.file(path).exists())) {
      violations.push({
        file: `${SCAFFOLD_DIR}/${name}`,
        field: "scaffold-toolchain",
        message: "Missing toolchain-profile scaffold file",
      });
    }
  }
  return violations;
}

export async function auditTemplateReadmeRegistry(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  let registry: TemplateRegistry;
  try {
    registry = await readTemplateRegistry(root);
  } catch {
    return [];
  }
  const readmePaths = [BUN_CREATE_README, TEMPLATES_FAMILY_README];
  const readmeTexts: string[] = [];
  for (const rel of readmePaths) {
    const path = join(root, rel);
    if (await Bun.file(path).exists()) {
      readmeTexts.push(await Bun.file(path).text());
    } else {
      violations.push({
        file: rel,
        field: "readme-registry",
        message: "Missing templates README for registry parity",
      });
    }
  }
  if (readmeTexts.length === 0) return violations;
  const combined = readmeTexts.join("\n");
  for (const entry of registry.templates) {
    const needle = `\`${entry.name}\``;
    if (!combined.includes(needle)) {
      violations.push({
        file: BUN_CREATE_README,
        field: "readme-registry",
        message: `Registry template "${entry.name}" not documented in templates README tables`,
      });
    }
  }
  return violations;
}

export async function auditTemplateModuleSlice(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const registerEffect = join(root, MODULES_DIR, "register-effect.ts");
  if (!(await Bun.file(registerEffect).exists())) {
    violations.push({
      file: `${MODULES_DIR}/register-effect.ts`,
      field: "module-slice",
      message: "Missing register-effect.ts helper for KIMI_MODULES",
    });
  } else {
    const text = await Bun.file(registerEffect).text();
    if (!text.includes("kimi.effect.") || !text.includes("registerEffect")) {
      violations.push({
        file: `${MODULES_DIR}/register-effect.ts`,
        field: "module-slice",
        message: "register-effect.ts must expose registerEffect() with kimi.effect.* symbols",
      });
    }
  }

  for (const slice of MODULE_PROCESSOR_SLICES) {
    const processor = join(root, MODULES_DIR, slice, "src", "processor.ts");
    if (!(await Bun.file(processor).exists())) {
      violations.push({
        file: `${MODULES_DIR}/${slice}/src/processor.ts`,
        field: "module-slice",
        message: `Missing processor.ts for module slice "${slice}"`,
      });
    }
  }

  const tradingRegistry = join(
    root,
    MODULES_DIR,
    "trading",
    "src",
    "trading",
    "gates",
    "registry.ts"
  );
  if (!(await Bun.file(tradingRegistry).exists())) {
    violations.push({
      file: `${MODULES_DIR}/trading/src/trading/gates/registry.ts`,
      field: "module-slice",
      message: "Missing trading gate registry for trading module slice",
    });
  }

  return violations;
}

export async function auditTemplateOxlint(root: string): Promise<TemplatePolicyViolation[]> {
  const proc = Bun.spawn({
    cmd: ["bunx", "oxlint", "templates"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit === 0) return [];
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const detail = (err || out).trim().split("\n").slice(0, 6).join(" · ");
  return [
    {
      file: "templates/",
      field: "oxlint",
      message: detail || `oxlint templates failed (exit ${exit})`,
    },
  ];
}

export async function auditTemplateOxfmt(root: string): Promise<TemplatePolicyViolation[]> {
  const oxfmtrc = join(root, ".oxfmtrc.json");
  if (!(await Bun.file(oxfmtrc).exists())) {
    return [
      {
        file: ".oxfmtrc.json",
        field: "oxfmt",
        message: "Missing .oxfmtrc.json — required for template format gate",
      },
    ];
  }
  const proc = Bun.spawn({
    cmd: ["bunx", "oxfmt", "--check", "-c", ".oxfmtrc.json", "templates/"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit === 0) return [];
  const out = await readableStreamToText(proc.stdout);
  const err = await readableStreamToText(proc.stderr);
  const detail = (err || out).trim().split("\n").slice(0, 6).join(" · ");
  return [
    {
      file: "templates/",
      field: "oxfmt",
      message: detail || `oxfmt --check templates/ failed (exit ${exit})`,
    },
  ];
}

export async function auditTemplateBunInitGuard(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const path of new Bun.Glob(POSTINSTALL_SCRIPT_GLOB).scanSync({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    const relPath = rel(root, path);
    for (const [i, line] of (await Bun.file(path).text()).split("\n").entries()) {
      if (line.trim().startsWith("//") || line.includes("@template-bootstrap-exempt")) continue;
      if (!BUN_INIT_FORBIDDEN_RE.test(line)) continue;
      violations.push({
        file: relPath,
        field: "bun-init-guard",
        message: `postinstall must not call bun init without -m (line ${i + 1}) — use kimi-fix bridge; see create-template SKILL`,
      });
    }
  }
  return violations;
}

export async function auditTemplateSecretsSlice(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const name of HERDR_SECRETS_FILES) {
    const relPath = `${HERDR_SECRETS_DIR}/${name}`;
    if (!(await Bun.file(join(root, relPath)).exists())) {
      violations.push({
        file: relPath,
        field: "secrets-slice",
        message: "Missing herdr-service-template secrets stub file",
      });
    }
  }

  const accessPath = join(root, HERDR_SECRETS_DIR, "access.ts");
  if (await Bun.file(accessPath).exists()) {
    const access = await Bun.file(accessPath).text();
    for (const needle of ["Bun.secrets", "enforceIsolation", "Bun.env"]) {
      if (access.includes(needle)) continue;
      violations.push({
        file: `${HERDR_SECRETS_DIR}/access.ts`,
        field: "secrets-slice",
        message: `access.ts must resolve via ${needle}`,
      });
    }
  }

  const isolationPath = join(root, HERDR_SECRETS_DIR, "isolation.ts");
  if (await Bun.file(isolationPath).exists()) {
    const isolation = await Bun.file(isolationPath).text();
    if (!isolation.includes("SecretIsolationError") || !isolation.includes("enforceIsolation")) {
      violations.push({
        file: `${HERDR_SECRETS_DIR}/isolation.ts`,
        field: "secrets-slice",
        message: "isolation.ts must export SecretIsolationError and enforceIsolation",
      });
    }
  }

  const legacyPath = join(root, HERDR_SECRETS_DIR, "legacy.ts");
  if (await Bun.file(legacyPath).exists()) {
    const legacy = await Bun.file(legacyPath).text();
    if (!legacy.includes("resolveDevSecrets")) {
      violations.push({
        file: `${HERDR_SECRETS_DIR}/legacy.ts`,
        field: "secrets-slice",
        message: "legacy.ts must export resolveDevSecrets() for spawn-before-resolve contract",
      });
    }
  }

  const postinstallPath = join(root, HERDR_SERVICE_TEMPLATE, "scripts/postinstall.ts");
  if (await Bun.file(postinstallPath).exists()) {
    const postinstall = await Bun.file(postinstallPath).text();
    for (const needle of ["Bun.secrets", "resolveDevSecrets", "enforceIsolation", "SECRET_NAMES"]) {
      if (postinstall.includes(needle)) continue;
      violations.push({
        file: `${HERDR_SERVICE_TEMPLATE}/scripts/postinstall.ts`,
        field: "secrets-slice",
        message: `postinstall generator must emit ${needle}`,
      });
    }
    if (!postinstall.includes("secrets.unit.test.ts")) {
      violations.push({
        file: `${HERDR_SERVICE_TEMPLATE}/scripts/postinstall.ts`,
        field: "secrets-slice",
        message: "postinstall must generate test/secrets.unit.test.ts regression scaffold",
      });
    }
    if (/\bbun\s+init\b/.test(postinstall)) {
      violations.push({
        file: `${HERDR_SERVICE_TEMPLATE}/scripts/postinstall.ts`,
        field: "bun-init-guard",
        message: "herdr postinstall must not call bun init — kimi-fix owns scaffold files",
      });
    }
  }

  const toolchainPostinstall = join(
    root,
    "templates/bun-create/kimi-toolchain/scripts/postinstall.ts"
  );
  if (await Bun.file(toolchainPostinstall).exists()) {
    const text = await Bun.file(toolchainPostinstall).text();
    if (!text.includes("--with-secrets")) {
      violations.push({
        file: "templates/bun-create/kimi-toolchain/scripts/postinstall.ts",
        field: "secrets-slice",
        message:
          "kimi-toolchain postinstall must support --with-secrets for optional secrets/ registry",
      });
    }
    if (!text.includes("resolveDevSecrets")) {
      violations.push({
        file: "templates/bun-create/kimi-toolchain/scripts/postinstall.ts",
        field: "secrets-slice",
        message:
          "kimi-toolchain postinstall must generate resolveDevSecrets() when --with-secrets is set",
      });
    }
  }

  return violations;
}

export async function auditTemplateSecretsEnvDocs(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const envExamples = [
    ...new Bun.Glob("templates/bun-create/*/.env.example").scanSync({
      cwd: root,
      onlyFiles: true,
    }),
    "templates/scaffold/env.example",
  ];
  for (const relPath of envExamples) {
    const text = await Bun.file(join(root, relPath)).text();
    for (const marker of ENV_EXAMPLE_REQUIRED_MARKERS) {
      if (text.includes(marker)) continue;
      violations.push({
        file: relPath,
        field: "secrets-env-docs",
        message: `Missing env.example marker: ${marker}`,
      });
    }
    const needsSecretsDoc =
      relPath.includes("herdr-service-template") ||
      relPath.includes("kimi-toolchain") ||
      relPath === "templates/scaffold/env.example";
    if (needsSecretsDoc && !/Bun\.secrets|replace_me/i.test(text)) {
      violations.push({
        file: relPath,
        field: "secrets-env-docs",
        message: "Must document Bun.secrets-first resolution or use replace_me placeholders",
      });
    }
  }
  return violations;
}

export async function auditTemplateSecretLeaks(root: string): Promise<TemplatePolicyViolation[]> {
  const result = await auditSecretLeaksInGlob(root, ["templates/**/*.ts", "templates/**/*.tsx"]);
  return result.findings.map((finding) => ({
    file: finding.file,
    field: "secret-leak",
    message: `${finding.type} access to ${finding.key} (line ${finding.line})`,
  }));
}

export async function auditTemplateBootstrapBridge(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const path = join(root, KIMI_NEW_ENTRY);
  if (!(await Bun.file(path).exists())) {
    return [
      {
        file: KIMI_NEW_ENTRY,
        field: "bootstrap-bridge",
        message: "Missing kimi-new greenfield entry (bridge pattern SSOT)",
      },
    ];
  }
  const text = await Bun.file(path).text();
  const violations: TemplatePolicyViolation[] = [];
  if (!/\bbun\s+init\s+(?:-m\b|--minimal\b)/.test(text)) {
    violations.push({
      file: KIMI_NEW_ENTRY,
      field: "bootstrap-bridge",
      message: "kimi-new must use bun init -m -y (minimal bridge) before kimi-fix",
    });
  }
  if (!text.includes("ensureDevSecretsResolved")) {
    violations.push({
      file: KIMI_NEW_ENTRY,
      field: "bootstrap-bridge",
      message: "kimi-new must call ensureDevSecretsResolved() before scaffolding",
    });
  }
  return violations;
}

export async function auditTemplatePostinstallBootstrap(
  root: string
): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  for (const path of new Bun.Glob(POSTINSTALL_SCRIPT_GLOB).scanSync({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    const text = await Bun.file(path).text();
    if (!text.includes("Bun.spawn")) continue;
    const relPath = rel(root, path);
    if (text.includes(POSTINSTALL_BOOTSTRAP_MARKER)) continue;
    violations.push({
      file: relPath,
      field: "postinstall-bootstrap",
      message: `Postinstall spawns subprocesses — add "${POSTINSTALL_BOOTSTRAP_MARKER}" header documenting pre-registry bootstrap`,
    });
  }
  return violations;
}

export async function auditTemplateBootstrapDocs(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const readmePath = join(root, BUN_CREATE_README);
  if (!(await Bun.file(readmePath).exists())) return violations;
  const text = await Bun.file(readmePath).text();
  if (!/bun init/i.test(text) || !/-m|--minimal|does not call `bun init`/i.test(text)) {
    violations.push({
      file: BUN_CREATE_README,
      field: "bootstrap-docs",
      message: "README must document bun init collision (use -m or avoid bun init in postinstall)",
    });
  }
  if (!/Bun\.secrets|secrets/i.test(text)) {
    violations.push({
      file: BUN_CREATE_README,
      field: "bootstrap-docs",
      message: "README must document secrets resolution (Bun.secrets + env fallback)",
    });
  }
  return violations;
}

export async function auditTemplateEnvExamples(root: string): Promise<TemplatePolicyViolation[]> {
  const violations: TemplatePolicyViolation[] = [];
  const templatePkgGlob = new Bun.Glob("templates/bun-create/*/package.json");
  for (const pkgPath of templatePkgGlob.scanSync({ cwd: root, absolute: true, onlyFiles: true })) {
    const projectDir = join(pkgPath, "..");
    const envExample = join(projectDir, ".env.example");
    if (!(await Bun.file(envExample).exists())) {
      violations.push({
        file: rel(root, projectDir),
        field: "env-example",
        message: "bun-create template missing .env.example",
      });
    }
  }
  const scaffoldExample = join(root, SCAFFOLD_DIR, "env.example");
  if (!(await Bun.file(scaffoldExample).exists())) {
    violations.push({
      file: `${SCAFFOLD_DIR}/env.example`,
      field: "env-example",
      message: "scaffold missing env.example",
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
    ...(await auditTemplateRegistrySchema(root)),
    ...(await auditTemplateReadmeRegistry(root)),
    ...(await auditTemplateBootstrapDocs(root)),
    ...(await auditTemplateBootstrapBridge(root)),
    ...(await auditTemplatePostinstallBootstrap(root)),
    ...(await auditTemplateBunInitGuard(root)),
    ...(await auditTemplateSecretsSlice(root)),
    ...(await auditTemplateSecretsEnvDocs(root)),
    ...(await auditTemplateSecretLeaks(root)),
    ...(await auditTemplateBunfigRuntime(root)),
    ...(await auditTemplateTsconfigs(root)),
    ...(await auditTemplateScaffoldFiles(root)),
    ...(await auditTemplateScaffoldToolchain(root)),
    ...(await auditTemplateScaffoldMarkers(root)),
    ...(await auditTemplateModuleSlice(root)),
    ...(await auditTemplateEntryShebangs(root)),
    ...(await auditTemplateEnvHygiene(root)),
    ...(await auditTemplateEnvExamples(root)),
    ...(await auditTemplateBannedTerms(root)),
    ...(await auditTemplateHardcodedSecrets(root)),
    ...(await auditTemplateOxlint(root)),
    ...(await auditTemplateOxfmt(root)),
    ...(await auditTemplateBunNative(root)),
    ...(await auditTemplateTestConventions(root)),
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
      moduleSlices: MODULE_PROCESSOR_SLICES.length + 1,
      scaffoldFiles: REQUIRED_SCAFFOLD_FILES.length,
      envExampleFiles: collectEnvExampleFiles(root).length,
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
    moduleSlices: MODULE_PROCESSOR_SLICES.length + 1,
    scaffoldFiles: REQUIRED_SCAFFOLD_FILES.length,
    envExampleFiles: collectEnvExampleFiles(root).length,
  };
}

export function defaultTemplatePolicyRoot(): string {
  return repoRoot(".");
}
