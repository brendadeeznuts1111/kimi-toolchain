import { pathExists, pathLstat, readLink, readText } from "./bun-io.ts";

import { join } from "path";
import { TOML } from "bun";
import { MIN_INTEGRATION_VERSIONS, REQUIRED_INTEGRATIONS, SPAWN_AGENTS } from "./herdr-agents.ts";
import { resolveHerdrSession } from "./herdr-project-cli.ts";
import { HerdrSessionError, requireSessionRunning } from "./herdr-session-preflight.ts";
import { homeDir } from "./paths.ts";
import { resolveHerdrPanePath } from "./herdr-pane-service.ts";
import { probeHerdrSocketTransport } from "./herdr-socket-transport.ts";

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
  requireSessionRunning?: (sessionName?: string) => Promise<void>;
}

function dxDir(home = homeDir()): string {
  return join(home, ".config", "dx");
}

function expand(path: string, home = homeDir()): string {
  return path.replace(/^~(?=$|\/)/, home).replace(/^~\//, `${home}/`);
}

/** Run a CLI command via Bun.spawnSync (Bun-native, synchronous). */
function run(cmd: string, args: string[] = [], _timeoutMs = 20_000) {
  try {
    const result = Bun.spawnSync({
      cmd: [cmd, ...args],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, PATH: resolveHerdrPanePath() },
    });
    // Bun.spawnSync doesn't support per-call timeout natively,
    // but herdr commands are fast (<1s) so 20s is generous.
    const stdout = result.stdout ? new TextDecoder().decode(result.stdout).trim() : "";
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr).trim() : "";
    if (result.exitCode === 0) {
      return { ok: true as const, output: stdout };
    }
    return { ok: false as const, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    return {
      ok: false as const,
      output: error instanceof Error ? error.message : String(error),
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
    return JSON.parse(readText(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSymlinkTo(path: string, expectedTarget: string): boolean {
  try {
    if (!pathLstat(path).isSymbolicLink()) return false;
    const target = readLink(path);
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
    const path = project?.path ? expand(project.path, home) : "";
    if (!path || !pathExists(path)) continue;
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
    const doc = TOML.parse(readText(configPath)) as Record<string, unknown>;
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
    warnings.push(`config parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return warnings;
}

function checkSpawnWrappers(home = homeDir()) {
  const spawnDir = join(home, ".local", "bin");
  const missing: string[] = [];
  for (const agent of SPAWN_AGENTS) {
    const path = join(spawnDir, `herdr-spawn-${agent}`);
    if (!pathExists(path)) missing.push(agent);
  }
  return missing;
}

function checkShellModule(home = homeDir()) {
  const zshrc = join(home, ".zshrc");
  try {
    return readText(zshrc).includes("herdr.sh");
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

export async function inspectHerdrDoctor(options: HerdrDoctorOptions = {}, home = homeDir()) {
  const dx = dxDir(home);
  const manifestPath = join(dx, "herdr.json");
  const configPath = join(dx, "herdr.toml");
  const runtimeConfig = join(home, ".config", "herdr", "config.toml");
  const skillPath = join(home, ".config", "agents", "skills", "herdr", "SKILL.md");
  const ensureSessionRunning = options.requireSessionRunning ?? requireSessionRunning;

  const blockers: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];
  const binary = which("herdr");
  const paneBinary = which("herdr-pane");
  const terminalNotifier = which("terminal-notifier");
  const version = binary ? run("herdr", ["--version"]) : { ok: false, output: "" };
  const configSymlinkOk = isSymlinkTo(runtimeConfig, configPath);
  const configExists = pathExists(configPath);
  const manifest = readJson(manifestPath);
  const skillExists = pathExists(skillPath);
  const shellModuleExists = pathExists(join(home, ".config", "shell", "herdr.sh"));
  const shellSourced = checkShellModule(home);
  const worktreesDir = expand(
    typeof manifest?.worktreesDir === "string" ? manifest.worktreesDir : "~/.herdr/worktrees",
    home
  );
  const parsedVersion = parseVersion(version.output);
  const socketTransportProbe = probeHerdrSocketTransport();

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
  if (!pathExists(worktreesDir)) warnings.push(`worktrees directory missing: ${worktreesDir}`);

  if (
    (socketTransportProbe.transport === "websocket" || socketTransportProbe.transport === "auto") &&
    !socketTransportProbe.wsSupported
  ) {
    warnings.push(
      `HERDR_SOCKET_TRANSPORT=${socketTransportProbe.transport} requires ws+unix WebSocket support (Bun 1.3.13+)`
    );
  }

  const missingWrappers = checkSpawnWrappers(home);
  if (missingWrappers.length) {
    warnings.push(`missing spawn wrappers: ${missingWrappers.join(", ")}`);
  }

  if (configExists) warnings.push(...lintConfig(configPath));

  const skillLinks = (Array.isArray(manifest?.agentSkills) ? manifest.agentSkills : []).map(
    (path) => expand(String(path), home)
  );
  const brokenSkillLinks = skillLinks.filter((path) => {
    try {
      return !pathLstat(path).isSymbolicLink();
    } catch {
      return true;
    }
  });
  if (brokenSkillLinks.length) {
    warnings.push(`agent skill links broken: ${brokenSkillLinks.join(", ")}`);
  }

  const projectProfiles = which("herdr-project") ? scanProjectProfiles(home) : [];
  if (!which("herdr-project")) warnings.push("herdr-project missing from PATH");

  if (parsedVersion && parsedVersion.major === 0 && parsedVersion.minor < 7) {
    warnings.push(
      `herdr ${parsedVersion.text} uses legacy pane ids — upgrade to 0.7.0+ for stable w1:p1 handles`
    );
  }

  const integrations = manifest?.integrations as { required?: string[] } | undefined;
  const requiredIntegrations = (Array.isArray(integrations?.required)
    ? integrations.required
    : null) || [...REQUIRED_INTEGRATIONS];

  let status = { ok: false, output: "" };
  let integrationVersions: Record<string, number> = {};
  const installed: string[] = [];
  const missing: string[] = [];
  const outdated: string[] = [];
  let manifestStatus = { ok: false, stale: [] as string[], result: null as unknown };
  let serverRunning = false;

  if (blockers.length === 0) {
    try {
      const session = resolveHerdrSession() || undefined;
      await ensureSessionRunning(session);

      status = run("herdr", ["status"]);
      serverRunning = /status:\s*running/.test(status.output);
      if (!serverRunning) warnings.push("herdr server is not running");

      const integrationStatus = run("herdr", ["integration", "status"]);
      integrationVersions = parseIntegrationVersions(integrationStatus.output);
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
      if (outdated.length) {
        warnings.push(`integrations below minimum for restore: ${outdated.join(", ")}`);
      }

      manifestStatus = checkManifests(binary);
      if (!manifestStatus.ok) {
        warnings.push(`agent manifests need attention: ${manifestStatus.stale.join(", ")}`);
      }
      if (options.fix && !manifestStatus.ok) {
        const updated = run("herdr", ["server", "update-agent-manifests"]);
        if (updated.ok) fixes.push("updated agent manifests");
        else warnings.push(`manifest update failed: ${updated.output}`);
      }
    } catch (error) {
      if (error instanceof HerdrSessionError) {
        warnings.push(error.message);
        serverRunning = false;
        if (options.fix) warnings.push("manifest fix skipped: server not running");
      } else {
        throw error;
      }
    }
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
      paneService: Boolean(paneBinary),
      socketTransport:
        socketTransportProbe.transport === "jsonl" || socketTransportProbe.wsSupported,
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
      paneBinary,
      projectProfiles,
      fixes,
      socketTransportProbe,
    },
    readiness: {
      ready: blockers.length === 0,
      blockers,
      warnings: [...new Set(warnings.filter(Boolean))],
    },
  };
}

export type HerdrDoctorReport = Awaited<ReturnType<typeof inspectHerdrDoctor>>;

function writeOut(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function printHerdrDoctorHuman(report: HerdrDoctorReport): void {
  writeOut("Herdr Doctor");
  writeOut(`Generated: ${report.generatedAt}`);
  writeOut("");
  for (const [name, ok] of Object.entries(report.checks)) {
    writeOut(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
  writeOut("");
  if (report.details.version) writeOut(`Version: ${report.details.version}`);
  if (report.details.binary) writeOut(`Binary: ${report.details.binary}`);
  if (report.details.paneBinary) writeOut(`Pane CLI: ${report.details.paneBinary}`);
  if (report.details.socketTransportProbe) {
    const probe = report.details.socketTransportProbe;
    writeOut(
      `Socket transport: ${probe.transport} (ws+unix: ${probe.wsSupported ? "yes" : "no"}, path: ${probe.socketPath})`
    );
  }
  writeOut(`Config: ${report.details.configPath}`);
  if (report.details.fixes?.length) writeOut(`Fixes: ${report.details.fixes.join("; ")}`);
  writeOut("");
  writeOut(`Status: ${report.readiness.ready ? "ready" : "blocked"}`);
  if (report.readiness.blockers.length) {
    writeOut(`Blockers: ${report.readiness.blockers.join("; ")}`);
  }
  if (report.readiness.warnings.length) {
    writeOut(`Warnings: ${report.readiness.warnings.join("; ")}`);
  }
}
