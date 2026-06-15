/**
 * DX/GitHub alignment checks.
 *
 * Keeps project-local dx.config.toml in parity with package scripts and GitHub CI.
 */

import { existsSync } from "fs";
import { join } from "path";
import YAML from "js-yaml";

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
    ? value.filter((item): item is string => typeof item === "string")
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
  try {
    return record(Bun.TOML.parse(await Bun.file(path).text()));
  } catch {
    return null;
  }
}

async function readYaml(path: string): Promise<UnknownRecord | null> {
  try {
    return record(YAML.load(await Bun.file(path).text()));
  } catch {
    return null;
  }
}

async function readPackage(
  path: string
): Promise<{ scripts: Record<string, string>; packageManager: string | null } | null> {
  try {
    const pkg = record(await Bun.file(path).json());
    const scriptsSource = record(pkg.scripts);
    const scripts: Record<string, string> = {};
    for (const [key, value] of Object.entries(scriptsSource)) {
      if (typeof value === "string") scripts[key] = value;
    }
    return { scripts, packageManager: stringValue(pkg.packageManager) };
  } catch {
    return null;
  }
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

function getPath(obj: UnknownRecord, path: string[]): unknown {
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

function addCommandCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  expected: string | null,
  actuals: readonly string[],
  targetLabel: string
): void {
  if (!expected) {
    checks.push(warn(name, `missing in dx.config.toml (${targetLabel})`));
    return;
  }
  checks.push(
    actuals.includes(expected)
      ? ok(name, expected)
      : warn(name, `${expected} not found in ${targetLabel}`)
  );
}

function addPackageScriptCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  expectedCommand: unknown,
  scripts: Record<string, string>
): void {
  const expected = stringValue(expectedCommand);
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
      ? ok(name, `package scripts exist: ${scriptNames.join(", ")}`)
      : warn(name, `missing package scripts: ${missing.join(", ")}`)
  );
}

function hasCommand(commands: readonly string[], expected: string): boolean {
  return commands.some((command) => command === expected);
}

function hasCommandContaining(commands: readonly string[], expected: string): boolean {
  return commands.some((command) => command.includes(expected));
}

function addRequiredListEntriesCheck(
  checks: DxGithubAlignmentCheck[],
  name: string,
  actual: readonly string[],
  required: readonly string[]
): void {
  const missing = required.filter((entry) => !actual.includes(entry));
  checks.push(
    missing.length === 0
      ? ok(name, `required entries present: ${required.join(", ")}`)
      : warn(name, `missing required entries: ${missing.join(", ")}`)
  );
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
      ? ok(name, `required commands present: ${required.join(", ")}`)
      : warn(name, `missing required commands: ${missing.join(", ")}`)
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
      ? ok(name, `required command fragments present: ${required.join(", ")}`)
      : warn(name, `missing command fragments: ${missing.join(", ")}`)
  );
}

function findBunVersionInSetupAction(action: UnknownRecord | null): string | null {
  const steps = getPath(action ?? {}, ["runs", "steps"]);
  if (!Array.isArray(steps)) return null;

  for (const step of steps) {
    const version = stringValue(record(record(step).with)["bun-version"]);
    if (version) return version;
  }
  return null;
}

function bunVersionFromPackageManager(packageManager: string | null): string | null {
  const match = packageManager?.match(/^bun@(.+)$/);
  return match?.[1] ?? null;
}

function bunScriptsFromCommands(commands: readonly string[]): string[] {
  const scripts = new Set<string>();
  for (const command of commands) {
    const matches = command.matchAll(/\bbun\s+run\s+([A-Za-z0-9:_-]+)/g);
    for (const match of matches) scripts.add(match[1]);
  }
  return [...scripts];
}

export async function checkDxGithubAlignment(
  projectRoot: string
): Promise<DxGithubAlignmentReport> {
  const dxPath = join(projectRoot, "dx.config.toml");
  if (!existsSync(dxPath)) return { applicable: false, aligned: true, checks: [] };

  const checks: DxGithubAlignmentCheck[] = [];
  const dx = await readToml(dxPath);
  if (!dx) {
    return {
      applicable: true,
      aligned: false,
      checks: [error("dx-config", "invalid TOML")],
    };
  }
  checks.push(ok("dx-config", "present"));

  const pkgPath = join(projectRoot, "package.json");
  const pkg = existsSync(pkgPath) ? await readPackage(pkgPath) : null;
  if (!pkg) {
    checks.push(error("package-json", "missing or invalid"));
    return { applicable: true, aligned: false, checks };
  }

  const runtime = record(dx.runtime);
  const quality = record(dx.quality);
  const github = record(dx.github);
  const githubCi = record(github.ci);
  const githubQuality = record(githubCi.quality);
  const githubGovernance = record(githubCi.governance);
  const sync = record(dx.sync);
  const agents = record(dx.agents);

  const packageManager = stringValue(runtime.packageManager);
  checks.push(
    packageManager === "bun"
      ? ok("runtime.packageManager", "bun")
      : warn("runtime.packageManager", `expected bun, got ${packageManager ?? "missing"}`)
  );

  const packageBunVersion = bunVersionFromPackageManager(pkg.packageManager);
  const dxBunVersion = stringValue(runtime.bunVersion);
  if (packageBunVersion && dxBunVersion === packageBunVersion) {
    checks.push(ok("runtime.bunVersion", dxBunVersion));
  } else if (packageBunVersion) {
    checks.push(
      warn("runtime.bunVersion", `expected ${packageBunVersion}, got ${dxBunVersion ?? "missing"}`)
    );
  }

  const setupActionPath = stringValue(github.setupAction) ?? ".github/actions/setup/action.yml";
  const setupAction = await readYaml(join(projectRoot, setupActionPath));
  const setupVersion = findBunVersionInSetupAction(setupAction);
  const ciBunVersion = stringValue(githubCi.bunVersion);
  if (setupVersion && ciBunVersion === setupVersion) {
    checks.push(ok("github.ci.bunVersion", ciBunVersion));
  } else if (setupVersion) {
    checks.push(
      warn("github.ci.bunVersion", `expected ${setupVersion}, got ${ciBunVersion ?? "missing"}`)
    );
  } else {
    checks.push(warn("github.setupAction", `${setupActionPath} missing Bun version`));
  }

  const scriptPairs: Array<[string, unknown, string]> = [
    ["quality.formatCheck", quality.formatCheck, "format:check"],
    ["quality.lintCheck", quality.lintCheck, "lint"],
    ["quality.typecheck", quality.typecheck, "typecheck"],
    ["quality.check", quality.check, "check"],
    ["quality.checkFast", quality.checkFast, "check:fast"],
    ["quality.testFast", quality.testFast, "test:fast"],
    ["quality.testCoverageCi", quality.testCoverageCi, "test:coverage:ci"],
    ["quality.formatCheckCi", quality.formatCheckCi, "format:check:ci"],
    ["sync.verify", sync.verify, "sync:verify"],
  ];

  for (const [name, configured, scriptName] of scriptPairs) {
    const expected = stringValue(configured);
    const actual = pkg.scripts[scriptName];
    if (!expected) {
      checks.push(warn(name, `missing; package script ${scriptName} is ${actual ?? "undefined"}`));
    } else if (actual && (expected === `bun run ${scriptName}` || expected === actual)) {
      checks.push(ok(name, expected));
    } else {
      checks.push(warn(name, `expected command for package script ${scriptName}, got ${expected}`));
    }
  }
  addPackageScriptCheck(checks, "github.ci.quality.smoke.script", githubQuality.smoke, pkg.scripts);
  addPackageScriptCheck(
    checks,
    "github.ci.governance.rScore.script",
    githubGovernance.rScore,
    pkg.scripts
  );

  const workflowPath = stringValue(github.workflow) ?? ".github/workflows/ci.yml";
  const workflow = await readYaml(join(projectRoot, workflowPath));
  if (!workflow) {
    checks.push(error("github.workflow", `${workflowPath} missing or invalid`));
  } else {
    checks.push(ok("github.workflow", workflowPath));
    const runCommands = collectRunCommands(workflow);
    addCommandCheck(
      checks,
      "github.ci.quality.format",
      stringValue(githubQuality.format),
      runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.lint",
      stringValue(githubQuality.lint),
      runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.typecheck",
      stringValue(githubQuality.typecheck),
      runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.tests",
      stringValue(githubQuality.tests),
      runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.quality.smoke",
      stringValue(githubQuality.smoke),
      runCommands,
      workflowPath
    );
    addCommandCheck(
      checks,
      "github.ci.governance.rScore",
      stringValue(githubGovernance.rScore),
      runCommands,
      workflowPath
    );
  }

  const agentCommands = [
    ...stringArray(agents.bootstrap),
    ...stringArray(agents.prePush),
    ...stringArray(agents.handoff),
    stringValue(agents.iterate),
    stringValue(agents.fullValidation),
  ].filter((command): command is string => typeof command === "string");
  const missingAgentScripts = bunScriptsFromCommands(agentCommands).filter(
    (script) => !pkg.scripts[script]
  );
  checks.push(
    missingAgentScripts.length === 0
      ? ok("agents.commands", "referenced package scripts exist")
      : warn("agents.commands", `missing package scripts: ${missingAgentScripts.join(", ")}`)
  );

  addRequiredListEntriesCheck(checks, "agents.firstRead", stringArray(agents.firstRead), [
    "/Users/nolarose/.config/dx/AGENTS.md",
    "AGENTS.md",
    "CODE_REFERENCES.md",
  ]);
  addRequiredCommandsCheck(checks, "agents.bootstrap", stringArray(agents.bootstrap), [
    "dx context",
    "dx config --project .",
    "dx mcp-status",
    "dx package",
  ]);
  addRequiredCommandsCheck(checks, "agents.prePush", stringArray(agents.prePush), [
    "kimi-githooks doctor",
    "bun run check",
    "kimi-guardian check",
    "kimi-governance score",
  ]);
  addRequiredCommandFragmentsCheck(checks, "agents.handoff", stringArray(agents.handoff), [
    "bun run sync",
    "bun run sync:verify",
    "kimi-doctor --agent-ready",
  ]);

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
  };
}
