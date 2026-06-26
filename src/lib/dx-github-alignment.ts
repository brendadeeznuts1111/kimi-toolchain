/**
 * DX/GitHub alignment checks.
 *
 * Keeps project-local dx.config.toml in parity with package scripts and GitHub CI.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import YAML from "js-yaml";
import { EFFECT_GATES_COMMAND } from "./finish-work-config.ts";

type Status = "ok" | "warn" | "error";
type UnknownRecord = Record<string, unknown>;

export interface DxGithubAlignmentCheck {
  name: string;
  status: Status;
  message: string;
  fixable: boolean;
}

export interface DxGithubAlignmentReport {
  applicable: boolean;
  aligned: boolean;
  checks: DxGithubAlignmentCheck[];
}

export const REQUIRED_AGENT_FIRST_READ_ENTRIES = ["AGENTS.md", "CODE_REFERENCES.md"] as const;

export const REQUIRED_AGENT_FIRST_READ_DX_SUFFIX = ".config/dx/AGENTS.md";

export const REQUIRED_AGENT_BOOTSTRAP = [
  "dx setup",
  "dx context",
  "dx config --project .",
  "dx mcp-status",
  "dx cli",
  "dx package",
] as const;

export const REQUIRED_AGENT_PRE_PUSH = [
  "kimi-githooks doctor",
  "bun run check:fast",
  "kimi-guardian check",
  EFFECT_GATES_COMMAND,
  "kimi-governance score",
] as const;

export const REQUIRED_AGENT_HANDOFF_FRAGMENTS = [
  "bun run sync",
  "bun run sync:verify",
  "kimi-doctor --agent-ready",
] as const;

export interface DxRuntimeConfig {
  packageManager: string | null;
  bunVersion: string | null;
}

export interface DxGithubCiQualityConfig {
  format: string | null;
  lint: string | null;
  typecheck: string | null;
  tests: string | null;
  smoke: string | null;
}

export interface DxGithubCiGovernanceConfig {
  rScore: string | null;
}

export interface DxGithubCiConfig {
  bunVersion: string | null;
  quality: DxGithubCiQualityConfig;
  governance: DxGithubCiGovernanceConfig;
}

export interface DxGithubConfig {
  workflow: string | null;
  setupAction: string | null;
  ci: DxGithubCiConfig;
}

export interface DxQualityConfig {
  formatCheck: string | null;
  lintCheck: string | null;
  typecheck: string | null;
  check: string | null;
  checkFast: string | null;
  testFast: string | null;
  testCoverageCi: string | null;
  formatCheckCi: string | null;
}

export interface DxSyncConfig {
  command: string | null;
  verify: string | null;
}

export interface DxAgentsConfig {
  firstRead: string[];
  bootstrap: string[];
  iterate: string | null;
  fullValidation: string | null;
  prePush: string[];
  handoff: string[];
}

export interface DxProjectConfig {
  runtime: DxRuntimeConfig;
  github: DxGithubConfig;
  quality: DxQualityConfig;
  sync: DxSyncConfig;
  agents: DxAgentsConfig;
}

export interface PackageManifest {
  scripts: Record<string, string>;
  packageManager: string | null;
}

export interface GithubWorkflow {
  runCommands: string[];
}

export interface GithubSetupAction {
  bunVersion: string | null;
}

export interface DxGithubAlignmentInputs {
  dx: DxProjectConfig;
  pkg: PackageManifest | null;
  workflow: GithubWorkflow | null;
  workflowPath: string;
  setupAction: GithubSetupAction | null;
  setupActionPath: string;
}

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function ok(name: string, message: string): DxGithubAlignmentCheck {
  return { name, status: "ok", message, fixable: false };
}

function warn(name: string, message: string): DxGithubAlignmentCheck {
  return { name, status: "warn", message, fixable: true };
}

function error(name: string, message: string): DxGithubAlignmentCheck {
  return { name, status: "error", message, fixable: true };
}

async function readToml(path: string): Promise<UnknownRecord | null> {
  if (!pathExists(path)) return null;
  const text = await Bun.file(path).text();
  try {
    return record(Bun.TOML.parse(text));
  } catch {
    return null;
  }
}

async function readYaml(path: string): Promise<UnknownRecord | null> {
  if (!pathExists(path)) return null;
  const text = await Bun.file(path).text();
  try {
    return record(YAML.load(text));
  } catch {
    return null;
  }
}

async function readPackage(path: string): Promise<PackageManifest | null> {
  if (!pathExists(path)) return null;
  const pkg = record(await Bun.file(path).json());
  const scriptsSource = record(pkg.scripts);
  const scripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(scriptsSource)) {
    if (typeof value === "string" && value.trim() !== "") scripts[key] = value;
  }
  return { scripts, packageManager: stringValue(pkg.packageManager) };
}

function collectRunCommands(value: unknown, commands: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRunCommands(item, commands);
    return commands;
  }
  if (!value || typeof value !== "object") return commands;

  const obj = value as UnknownRecord;
  if (typeof obj.run === "string") commands.push(obj.run.trim());
  for (const nested of Object.values(obj)) collectRunCommands(nested, commands);
  return commands;
}

function getPath(obj: UnknownRecord, path: readonly string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    current = record(current)[key];
  }
  return current;
}

function parseDxProjectConfig(dx: UnknownRecord): DxProjectConfig {
  const runtime = record(dx.runtime);
  const quality = record(dx.quality);
  const github = record(dx.github);
  const githubCi = record(github.ci);
  const githubQuality = record(githubCi.quality);
  const githubGovernance = record(githubCi.governance);
  const sync = record(dx.sync);
  const agents = record(dx.agents);

  return {
    runtime: {
      packageManager: stringValue(runtime.packageManager),
      bunVersion: stringValue(runtime.bunVersion),
    },
    github: {
      workflow: stringValue(github.workflow),
      setupAction: stringValue(github.setupAction),
      ci: {
        bunVersion: stringValue(githubCi.bunVersion),
        quality: {
          format: stringValue(githubQuality.format),
          lint: stringValue(githubQuality.lint),
          typecheck: stringValue(githubQuality.typecheck),
          tests: stringValue(githubQuality.tests),
          smoke: stringValue(githubQuality.smoke),
        },
        governance: {
          rScore: stringValue(githubGovernance.rScore),
        },
      },
    },
    quality: {
      formatCheck: stringValue(quality.formatCheck),
      lintCheck: stringValue(quality.lintCheck),
      typecheck: stringValue(quality.typecheck),
      check: stringValue(quality.check),
      checkFast: stringValue(quality.checkFast),
      testFast: stringValue(quality.testFast),
      testCoverageCi: stringValue(quality.testCoverageCi),
      formatCheckCi: stringValue(quality.formatCheckCi),
    },
    sync: {
      command: stringValue(sync.command),
      verify: stringValue(sync.verify),
    },
    agents: {
      firstRead: stringArray(agents.firstRead),
      bootstrap: stringArray(agents.bootstrap),
      iterate: stringValue(agents.iterate),
      fullValidation: stringValue(agents.fullValidation),
      prePush: stringArray(agents.prePush),
      handoff: stringArray(agents.handoff),
    },
  };
}

function parseGithubWorkflow(workflow: UnknownRecord | null): GithubWorkflow | null {
  return workflow ? { runCommands: collectRunCommands(workflow) } : null;
}

function parseGithubSetupAction(action: UnknownRecord | null): GithubSetupAction | null {
  const steps = getPath(action ?? {}, ["runs", "steps"]);
  if (!Array.isArray(steps)) return action ? { bunVersion: null } : null;

  for (const step of steps) {
    const version = stringValue(record(record(step).with)["bun-version"]);
    if (version) return { bunVersion: version };
  }
  return { bunVersion: null };
}

function addCommandCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  expected: string | null,
  actuals: readonly string[],
  targetLabel: string
): void {
  if (!expected) {
    checks.push(warn(name, "missing in dx.config.toml (" + targetLabel + ")"));
    return;
  }
  checks.push(
    actuals.includes(expected)
      ? ok(name, expected)
      : warn(name, expected + " not found in " + targetLabel)
  );
}

function addPackageScriptCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  expected: string | null,
  scripts: Record<string, string>
): void {
  if (!expected) {
    checks.push(warn(name, "missing in dx.config.toml"));
    return;
  }

  const scriptNames = bunScriptsFromCommands([expected]);
  if (scriptNames.length === 0) {
    checks.push(ok(name, "no package script reference"));
    return;
  }

  const missing = scriptNames.filter((script) => !scripts[script]);
  checks.push(
    missing.length === 0
      ? ok(name, "package scripts exist: " + scriptNames.join(", "))
      : warn(name, "missing package scripts: " + missing.join(", "))
  );
}

function hasCommand(commands: readonly string[], expected: string): boolean {
  return commands.some((command) => command === expected);
}

function hasCommandContaining(commands: readonly string[], expected: string): boolean {
  return commands.some((command) => command.includes(expected));
}

function addRequiredCommandsCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  actual: readonly string[],
  required: readonly string[]
): void {
  const missing = required.filter((command) => !hasCommand(actual, command));
  checks.push(
    missing.length === 0
      ? ok(name, "required commands present: " + required.join(", "))
      : warn(name, "missing required commands: " + missing.join(", "))
  );
}

function addRequiredCommandFragmentsCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  actual: readonly string[],
  required: readonly string[]
): void {
  const missing = required.filter((fragment) => !hasCommandContaining(actual, fragment));
  checks.push(
    missing.length === 0
      ? ok(name, "required command fragments present: " + required.join(", "))
      : warn(name, "missing command fragments: " + missing.join(", "))
  );
}

function bunVersionFromPackageManager(packageManager: string | null): string | null {
  const match = packageManager?.match(/^bun@(.+)$/);
  return match?.[1] ?? null;
}

function bunScriptsFromCommands(commands: readonly string[]): string[] {
  const scripts = new Set<string>();
  for (const command of commands) {
    const matches = command.matchAll(/\bbun\s+run\s+([A-Za-z0-9:_-]+)/g);
    for (const match of matches) {
      const script = match[1];
      if (script) scripts.add(script);
    }
  }
  return [...scripts];
}

export function evaluateDxGithubAlignment(
  inputs: DxGithubAlignmentInputs
): DxGithubAlignmentReport {
  const checks: DxGithubAlignmentCheck[] = [ok("dx-config", "present")];
  const { dx, pkg, workflow, workflowPath, setupAction, setupActionPath } = inputs;

  if (!pkg) {
    checks.push(error("package-json", "missing or invalid"));
    return { applicable: true, aligned: false, checks };
  }

  const packageManager = dx.runtime.packageManager;
  checks.push(
    packageManager === "bun"
      ? ok("runtime.packageManager", "bun")
      : warn("runtime.packageManager", "expected bun, got " + (packageManager ?? "missing"))
  );

  const packageBunVersion = bunVersionFromPackageManager(pkg.packageManager);
  const dxBunVersion = dx.runtime.bunVersion;
  if (packageBunVersion && dxBunVersion === packageBunVersion) {
    checks.push(ok("runtime.bunVersion", dxBunVersion));
  } else if (packageBunVersion) {
    checks.push(
      warn(
        "runtime.bunVersion",
        "expected " + packageBunVersion + ", got " + (dxBunVersion ?? "missing")
      )
    );
  }

  const setupVersion = setupAction?.bunVersion ?? null;
  const ciBunVersion = dx.github.ci.bunVersion;
  if (setupVersion && ciBunVersion === setupVersion) {
    checks.push(ok("github.ci.bunVersion", ciBunVersion));
  } else if (setupVersion) {
    checks.push(
      warn(
        "github.ci.bunVersion",
        "expected " + setupVersion + ", got " + (ciBunVersion ?? "missing")
      )
    );
  } else {
    checks.push(warn("github.setupAction", setupActionPath + " missing Bun version"));
  }

  const scriptPairs: Array<[string, string | null, string]> = [
    ["quality.formatCheck", dx.quality.formatCheck, "format:check"],
    ["quality.lintCheck", dx.quality.lintCheck, "lint"],
    ["quality.typecheck", dx.quality.typecheck, "typecheck"],
    ["quality.check", dx.quality.check, "check"],
    ["quality.checkFast", dx.quality.checkFast, "check:fast"],
    ["quality.testFast", dx.quality.testFast, "test:fast"],
    ["quality.testCoverageCi", dx.quality.testCoverageCi, "test:coverage:ci"],
    ["quality.formatCheckCi", dx.quality.formatCheckCi, "format:check:ci"],
  ];
  if (dx.sync.command || dx.sync.verify) {
    scriptPairs.push(["sync.verify", dx.sync.verify, "sync:verify"]);
  }

  for (const [name, expected, scriptName] of scriptPairs) {
    const actual = pkg.scripts[scriptName];
    if (!expected) {
      checks.push(
        warn(name, "missing; package script " + scriptName + " is " + (actual ?? "undefined"))
      );
    } else if (actual && (expected === "bun run " + scriptName || expected === actual)) {
      checks.push(ok(name, expected));
    } else {
      checks.push(
        warn(name, "expected command for package script " + scriptName + ", got " + expected)
      );
    }
  }

  if (dx.github.ci.quality.smoke) {
    addPackageScriptCheck(
      checks,
      "github.ci.quality.smoke.script",
      dx.github.ci.quality.smoke,
      pkg.scripts
    );
  }
  addPackageScriptCheck(
    checks,
    "github.ci.governance.rScore.script",
    dx.github.ci.governance.rScore,
    pkg.scripts
  );

  if (!workflow) {
    checks.push(error("github.workflow", workflowPath + " missing or invalid"));
  } else {
    checks.push(ok("github.workflow", workflowPath));
    addCommandCheck(
      checks,
      "github.ci.quality.format",
      dx.github.ci.quality.format,
      workflow.runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.lint",
      dx.github.ci.quality.lint,
      workflow.runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.typecheck",
      dx.github.ci.quality.typecheck,
      workflow.runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.tests",
      dx.github.ci.quality.tests,
      workflow.runCommands,
      workflowPath
    );
    if (dx.github.ci.quality.smoke) {
      addCommandCheck(
        checks,
        "github.ci.quality.smoke",
        dx.github.ci.quality.smoke,
        workflow.runCommands,
        workflowPath
      );
    }
    addCommandCheck(
      checks,
      "github.ci.governance.rScore",
      dx.github.ci.governance.rScore,
      workflow.runCommands,
      workflowPath
    );
  }

  const agentCommands = [
    ...dx.agents.bootstrap,
    ...dx.agents.prePush,
    ...dx.agents.handoff,
    dx.agents.iterate,
    dx.agents.fullValidation,
  ].filter((command): command is string => typeof command === "string");
  const missingAgentScripts = bunScriptsFromCommands(agentCommands).filter(
    (script) => !pkg.scripts[script]
  );
  checks.push(
    missingAgentScripts.length === 0
      ? ok("agents.commands", "referenced package scripts exist")
      : warn("agents.commands", "missing package scripts: " + missingAgentScripts.join(", "))
  );

  const missingFirstRead = REQUIRED_AGENT_FIRST_READ_ENTRIES.filter(
    (entry) => !dx.agents.firstRead.includes(entry)
  );
  const hasDxAgents = dx.agents.firstRead.some((entry) =>
    entry.includes(REQUIRED_AGENT_FIRST_READ_DX_SUFFIX)
  );
  if (missingFirstRead.length === 0 && hasDxAgents) {
    checks.push(ok("agents.firstRead", "required entries present"));
  } else {
    const gaps = [
      ...missingFirstRead.map((entry) => `missing ${entry}`),
      ...(hasDxAgents ? [] : [`missing path ending with ${REQUIRED_AGENT_FIRST_READ_DX_SUFFIX}`]),
    ];
    checks.push(warn("agents.firstRead", gaps.join("; ")));
  }
  addRequiredCommandsCheck(
    checks,
    "agents.bootstrap",
    dx.agents.bootstrap,
    REQUIRED_AGENT_BOOTSTRAP
  );
  addRequiredCommandsCheck(checks, "agents.prePush", dx.agents.prePush, REQUIRED_AGENT_PRE_PUSH);
  const handoffFragments = dx.sync.command
    ? [...REQUIRED_AGENT_HANDOFF_FRAGMENTS]
    : (["kimi-doctor --agent-ready"] as const);
  addRequiredCommandFragmentsCheck(checks, "agents.handoff", dx.agents.handoff, handoffFragments);

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
  };
}

export async function checkDxGithubAlignment(
  projectRoot: string
): Promise<DxGithubAlignmentReport> {
  const dxPath = join(projectRoot, "dx.config.toml");
  if (!pathExists(dxPath)) return { applicable: false, aligned: true, checks: [] };

  const rawDx = await readToml(dxPath);
  if (!rawDx) {
    return {
      applicable: true,
      aligned: false,
      checks: [error("dx-config", "invalid TOML")],
    };
  }

  const dx = parseDxProjectConfig(rawDx);
  const workflowPath = dx.github.workflow ?? ".github/workflows/ci.yml";
  const setupActionPath = dx.github.setupAction ?? ".github/actions/setup/action.yml";
  const pkgPath = join(projectRoot, "package.json");

  return evaluateDxGithubAlignment({
    dx,
    pkg: pathExists(pkgPath) ? await readPackage(pkgPath) : null,
    workflow: parseGithubWorkflow(await readYaml(join(projectRoot, workflowPath))),
    workflowPath,
    setupAction: parseGithubSetupAction(await readYaml(join(projectRoot, setupActionPath))),
    setupActionPath,
  });
}
