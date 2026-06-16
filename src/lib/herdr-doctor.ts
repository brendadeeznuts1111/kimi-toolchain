import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { TOML } from "bun";
import {
  MIN_INTEGRATION_VERSIONS,
  REQUIRED_INTEGRATIONS,
  SPAWN_AGENTS,
} from "./herdr-agents.ts";
import { homeDir } from "./paths.ts";

const KNOWN_TOP_LEVEL = new Set([
  "onboarding",
  "theme",
  "terminal",
  "update",
  "keys",
  "ui",
  "session",
  "remote",
  "worktrees",
  "experimental",
  "advanced",
]);

const DEPRECATED_SECTIONS: Record<string, string> = {
  toast: "ui.toast",
};

export interface HerdrDoctorOptions {
  fix?: boolean;
}

function dxDir(home = homeDir()): string {
  return join(home, ".config", "dx");
}

function expand(path: string, home = homeDir()): string {
  return path.replace(/^~(?=$|\/)/, home).replace(/^~\//, `${home}/`);
}

function run(cmd: string, args: string[] = [], timeout = 20_000) {
  try {
    return {
      ok: true,
      output: execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      }).trim(),
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: `${err.stdout || ""}${err.stderr || ""}`.trim(),
    };
  }
}

function runJson(cmd: string, args: string[] = []) {
  const result = run(cmd, args);
  if (!result.ok) return { ok: false as const, json: null, output: result.output };
  try {
    return { ok: true as const, json: JSON.parse(result.output), output: result.output };
  } catch {
    return { ok: false as const, json: null, output: result.output };
  }
}

function which(command: string): string | null {
  const result = run("which", [command]);
  return result.ok ? result.output : null;
}

function readJson(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSymlinkTo(path: string, expectedTarget: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const target = readlinkSync(path);
    const resolved = target.startsWith("/") ? target : join(path, "..", target);
    return resolved === expectedTarget;
  } catch {
    return false;
  }
}

function scanProjectProfiles(home = homeDir()) {
  const projects = readJson(join(dxDir(home), "projects.json")) as {
    topProjects?: Array<{ key?: string; path?: string }>;
  } | null;
  const rows: Array<{ key: string; path: string; label: string }> = [];
  for (const project of projects?.topProjects || []) {
    const path = project?.path;
    if (!path || !existsSync(path)) continue;
    const result = run("herdr-project", ["has-config", path]);
    if (result.ok) {
      const discover = run("herdr-project", ["discover", path, "--json"]);
      let label = project.key || path;
      try {
        const payload = JSON.parse(discover.output) as {
          config?: { workspaceLabel?: string };
        };
        label = payload.config?.workspaceLabel || label;
      } catch {
        // ignore parse errors
      }
      rows.push({ key: project.key || path, path, label });
    }
  }
  return rows;
}

function parseIntegrationVersions(output: string) {
  const versions: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s+current\s+\(v(\d+)\)/);
    if (match) versions[match[1]] = Number(match[2]);
    const missing = line.match(/^(\w+):\s+not installed/);
    if (missing) versions[missing[1]] = 0;
  }
  return versions;
}

function lintConfig(configPath: string) {
  const warnings: string[] = [];
  try {
    const doc = TOML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(doc)) {
      if (key === "keys.command") continue;
      if (!KNOWN_TOP_LEVEL.has(key)) {
        const hint = DEPRECATED_SECTIONS[key];
        warnings.push(
          hint ? `unknown section [${key}] — use [${hint}]` : `unknown top-level section [${key}]`
        );
      }
    }
    const commands = doc["keys.command"];
    if (Array.isArray(commands)) {
      for (const entry of commands) {
        const command =
          entry && typeof entry === "object" && "command" in entry
            ? (entry as { command?: unknown }).command
            : undefined;
        if (typeof command === "string" && !command.includes("herdr-spawn-")) {
          const bare = command.split("/").pop();
          if (bare && (SPAWN_AGENTS as readonly string[]).includes(bare)) {
            warnings.push(
              `keys.command uses bare agent name "${command}" — use ~/.local/bin/herdr-spawn-${bare}`
            );
          }
        }
      }
    }
  } catch (error) {
    warnings.push(
      `config parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return warnings;
}

function checkSpawnWrappers(home = homeDir()) {
  const spawnDir = join(home, ".local", "bin");
  const missing: string[] = [];
  for (const agent of SPAWN_AGENTS) {
    const path = join(spawnDir, `herdr-spawn-${agent}`);
    if (!existsSync(path)) missing.push(agent);
  }
  return missing;
}

function checkShellModule(home = homeDir()) {
  const zshrc = join(home, ".zshrc");
  try {
    return readFileSync(zshrc, "utf8").includes("herdr.sh");
  } catch {
    return false;
  }
}

function checkManifests(binary: string | null) {
  if (!binary) return { ok: false, stale: [] as string[], result: null };
  const manifests = runJson("herdr", ["server", "agent-manifests", "--json"]);
  if (!manifests.ok || !manifests.json?.result) {
    return { ok: false, stale: ["manifest check failed"], result: null };
  }
  const result = manifests.json.result as {
    manifests?: Array<{ agent?: string; remote_update_result?: string }>;
    last_result?: string;
  };
  const stale = (result.manifests || [])
    .filter((entry) => entry.remote_update_result && entry.remote_update_result !== "current")
    .map((entry) => entry.agent || "unknown");
  if (result.last_result && result.last_result !== "checked") {
    stale.push(`last_result:${result.last_result}`);
  }
  return { ok: stale.length === 0, stale, result };
}

function parseVersion(versionText: string | null | undefined) {
  const match = String(versionText || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match
    ? {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        text: match[0],
      }
    : null;
}

export function inspectHerdrDoctor(options: HerdrDoctorOptions = {}, home = homeDir()) {
  const dx = dxDir(home);
  const manifestPath = join(dx, "herdr.json");
  const configPath = join(dx, "herdr.toml");
  const runtimeConfig = join(home, ".config", "herdr", "config.toml");
  const skillPath = join(home, ".config", "agents", "skills", "herdr", "SKILL.md");

  const blockers: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];
  const binary = which("herdr");
  const terminalNotifier = which("terminal-notifier");
  const version = binary ? run("herdr", ["--version"]) : { ok: false, output: "" };
  const status = binary ? run("herdr", ["status"]) : { ok: false, output: "" };
  const integrationStatus = binary
    ? run("herdr", ["integration", "status"])
    : { ok: false, output: "" };
  const configSymlinkOk = isSymlinkTo(runtimeConfig, configPath);
  const configExists = existsSync(configPath);
  const manifest = readJson(manifestPath);
  const skillExists = existsSync(skillPath);
  const shellModuleExists = existsSync(join(home, ".config", "shell", "herdr.sh"));
  const shellSourced = checkShellModule(home);
  const worktreesDir = expand(
    typeof manifest?.worktreesDir === "string" ? manifest.worktreesDir : "~/.herdr/worktrees",
    home
  );
  const parsedVersion = parseVersion(version.output);

  if (!binary) blockers.push("herdr binary missing from PATH");
  if (!configExists) blockers.push(`missing config: ${configPath}`);
  if (!configSymlinkOk) warnings.push(`runtime config is not symlinked to ${configPath}`);
  if (!manifest) warnings.push(`missing manifest: ${manifestPath}`);
  if (!skillExists) warnings.push(`missing skill: ${skillPath}`);
  if (!shellModuleExists) warnings.push("missing shell module: ~/.config/shell/herdr.sh");
  if (!shellSourced) warnings.push("~/.zshrc does not source ~/.config/shell/herdr.sh");
  if (!terminalNotifier) {
    warnings.push("terminal-notifier missing; system notifications may fall back to osascript");
  }
  if (!existsSync(worktreesDir)) warnings.push(`worktrees directory missing: ${worktreesDir}`);

  const integrations = manifest?.integrations as { required?: string[] } | undefined;
  const requiredIntegrations =
    (Array.isArray(integrations?.required) ? integrations.required : null) ||
    [...REQUIRED_INTEGRATIONS];
  const integrationVersions = parseIntegrationVersions(integrationStatus.output);
  const installed: string[] = [];
  const missing: string[] = [];
  const outdated: string[] = [];
  for (const name of requiredIntegrations) {
    const versionNum = integrationVersions[name];
    if (!versionNum) {
      missing.push(name);
      continue;
    }
    installed.push(name);
    const minVersions = manifest?.minIntegrationVersions as Record<string, number> | undefined;
    const min = MIN_INTEGRATION_VERSIONS[name] ?? minVersions?.[name];
    if (min && versionNum < min) outdated.push(`${name} v${versionNum} < v${min}`);
  }
  if (missing.length) warnings.push(`integrations not current: ${missing.join(", ")}`);
  if (outdated.length) warnings.push(`integrations below minimum for restore: ${outdated.join(", ")}`);

  const manifestStatus = checkManifests(binary);
  if (!manifestStatus.ok) {
    warnings.push(`agent manifests need attention: ${manifestStatus.stale.join(", ")}`);
  }
  if (options.fix && binary && !manifestStatus.ok) {
    const updated = run("herdr", ["server", "update-agent-manifests"]);
    if (updated.ok) fixes.push("updated agent manifests");
    else warnings.push(`manifest update failed: ${updated.output}`);
  }

  const missingWrappers = checkSpawnWrappers(home);
  if (missingWrappers.length) {
    warnings.push(`missing spawn wrappers: ${missingWrappers.join(", ")}`);
  }

  warnings.push(...lintConfig(configPath));

  const skillLinks = (Array.isArray(manifest?.agentSkills) ? manifest.agentSkills : []).map(
    (path) => expand(String(path), home)
  );
  const brokenSkillLinks = skillLinks.filter((path) => {
    try {
      return !lstatSync(path).isSymbolicLink();
    } catch {
      return true;
    }
  });
  if (brokenSkillLinks.length) {
    warnings.push(`agent skill links broken: ${brokenSkillLinks.join(", ")}`);
  }

  const serverRunning = /status:\s*running/.test(status.output);
  if (binary && !serverRunning) warnings.push("herdr server is not running");

  const projectProfiles = which("herdr-project") ? scanProjectProfiles(home) : [];
  if (!which("herdr-project")) warnings.push("herdr-project missing from PATH");

  if (parsedVersion && parsedVersion.major === 0 && parsedVersion.minor < 7) {
    warnings.push(
      `herdr ${parsedVersion.text} uses legacy pane ids — upgrade to 0.7.0+ for stable w1:p1 handles`
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifest: manifest
      ? {
          name: manifest.name,
          configPath: manifest.configPath,
        }
      : null,
    checks: {
      binary: Boolean(binary),
      version: version.ok,
      config: configExists,
      configSymlink: configSymlinkOk,
      manifest: Boolean(manifest),
      skill: skillExists,
      shellModule: shellModuleExists,
      shellSourced,
      terminalNotifier: Boolean(terminalNotifier),
      integrations: missing.length === 0 && outdated.length === 0,
      agentManifests: manifestStatus.ok,
      spawnWrappers: missingWrappers.length === 0,
      server: serverRunning,
      projectTool: Boolean(which("herdr-project")),
    },
    details: {
      binary,
      version: version.output || null,
      configPath,
      runtimeConfigPath: runtimeConfig,
      skillPath,
      installedIntegrations: installed,
      missingIntegrations: missing,
      outdatedIntegrations: outdated,
      integrationVersions,
      manifestStatus: manifestStatus.result,
      serverStatus: status.ok ? status.output : status.output || null,
      projectProfiles,
      fixes,
    },
    readiness: {
      ready: blockers.length === 0,
      blockers,
      warnings: [...new Set(warnings.filter(Boolean))],
    },
  };
}

export function printHerdrDoctorHuman(report: ReturnType<typeof inspectHerdrDoctor>): void {
  console.log("Herdr Doctor");
  console.log(`Generated: ${report.generatedAt}`);
  console.log("");
  for (const [name, ok] of Object.entries(report.checks)) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
  console.log("");
  if (report.details.version) console.log(`Version: ${report.details.version}`);
  if (report.details.binary) console.log(`Binary: ${report.details.binary}`);
  console.log(`Config: ${report.details.configPath}`);
  if (report.details.fixes?.length) console.log(`Fixes: ${report.details.fixes.join("; ")}`);
  console.log("");
  console.log(`Status: ${report.readiness.ready ? "ready" : "blocked"}`);
  if (report.readiness.blockers.length) {
    console.log(`Blockers: ${report.readiness.blockers.join("; ")}`);
  }
  if (report.readiness.warnings.length) {
    console.log(`Warnings: ${report.readiness.warnings.join("; ")}`);
  }
}