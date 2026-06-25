import { writeStdoutLine } from "./cli-contract.ts";
import { pathExists, pathLstat, readText } from "./bun-io.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";

import { TOML } from "bun";
import { MIN_INTEGRATION_VERSIONS, REQUIRED_INTEGRATIONS, SPAWN_AGENTS } from "./herdr-agents.ts";
import { resolveHerdrSession } from "./herdr-project-cli.ts";
import { HerdrSessionError, requireSessionRunning } from "./herdr-session-preflight.ts";
import { homeDir } from "./paths.ts";
import { resolveHerdrPanePath } from "./herdr-pane-service.ts";
import {
  buildHerdrSocketRecoveryPlan,
  parseHerdrCliProtocolError,
  probeHerdrServerProcesses,
  type HerdrCliProtocolErrorCode,
} from "./herdr-cli-error.ts";
import {
  buildFixSocketPlanSnapshot,
  executeFixSocketLive,
  type FixSocketLiveDeps,
} from "./herdr-fix-socket-live.ts";
import {
  probeHerdrSocketHealth,
  probeHerdrSocketTransport,
  type HerdrSocketHealthProbe,
} from "./herdr-socket-transport.ts";

export type {
  HerdrCliProtocolErrorCode,
  HerdrSocketRecoveryExecution,
  HerdrSocketRecoveryStep,
  HerdrServerProcess,
} from "./herdr-cli-error.ts";
export {
  buildHerdrSocketRecoveryPlan,
  materializeHerdrSocketRecoveryPlan,
  parseHerdrCliProtocolError,
  parsePgrepHerdrServerLines,
  probeHerdrServerProcesses,
} from "./herdr-cli-error.ts";

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

export type HerdrSocketDoctorHintCode =
  | "EADDRINUSE"
  | "EAGAIN"
  | "ENOENT"
  | "ECONNREFUSED"
  | "stale_socket"
  | "healthy";

export type HerdrSocketDoctorHint = {
  code: HerdrSocketDoctorHintCode;
  severity: "info" | "warn" | "error";
  summary: string;
  detail: string;
  action?: string;
};

/** Taxonomy id for Herdr CLI saturation errors (error-taxonomy.yml#herdr_socket_saturation). */
export const HERDR_SOCKET_SATURATION_TAXONOMY_ID = "herdr_socket_saturation";

/** Reference hints for unix socket bind/connect failures (taxonomy: port_conflict / herdr_socket_saturation / network_timeout). */
export const HERDR_SOCKET_ERROR_HINTS: Record<
  "EADDRINUSE" | "EAGAIN" | "ENOENT" | "ECONNREFUSED",
  HerdrSocketDoctorHint
> = {
  EADDRINUSE: {
    code: "EADDRINUSE",
    severity: "warn",
    summary: "Unix socket path already bound",
    detail:
      "Another herdr server or stale listener holds this socket path. Bun 1.4+ returns EADDRINUSE on bind instead of silently replacing the file.",
    action:
      "Run `herdr status` (or `herdr --session NAME status`). Stop the live server, or remove a stale socket only after confirming nothing is listening.",
  },
  EAGAIN: {
    code: "EAGAIN",
    severity: "warn",
    summary: "Herdr IPC saturated (resource temporarily unavailable)",
    detail:
      "The Herdr server accepted API status checks but refused a new client attach — typical when many events.subscribe streams or long-running dashboard/orchestrator processes hold the unix socket open. `herdr server stop` may return success while the server stays running.",
    action:
      "Stop `herdr-orchestrator dashboard`, kill stale `bun test` processes, then `pkill -f '/opt/homebrew/opt/herdr/bin/herdr server'` (or your herdr server path) and run `herdr` again. Inspect ~/.config/herdr/herdr-server.log for stream_closed churn.",
  },
  ENOENT: {
    code: "ENOENT",
    severity: "warn",
    summary: "Unix socket file missing",
    detail:
      "The expected herdr.sock path does not exist — the server is not running or a different session/path is in use.",
    action: "Start the server: `herdr server` or `herdr --session NAME server`.",
  },
  ECONNREFUSED: {
    code: "ECONNREFUSED",
    severity: "warn",
    summary: "Unix socket not accepting connections",
    detail:
      "Connect to the socket path was refused. The file may be stale (crashed server) or the listener is not ready yet.",
    action:
      "If the file exists but connect fails, remove the stale socket and restart: `rm -f <socket> && herdr server`.",
  },
};

/** Parse Herdr CLI stderr/stdout for socket errors (taxonomy via parseHerdrCliProtocolError). */
export function parseHerdrCliSocketError(output: string): HerdrSocketDoctorHint | null {
  const parsed = parseHerdrCliProtocolError(output);
  if (!parsed || parsed.code === "UNKNOWN") return null;
  const base =
    parsed.code === "EAGAIN"
      ? HERDR_SOCKET_ERROR_HINTS.EAGAIN
      : HERDR_SOCKET_ERROR_HINTS.ECONNREFUSED;
  return {
    ...base,
    detail: `${base.detail} Matched: ${parsed.raw.slice(0, 200)}`,
  };
}

/** Structured socket hints from health probe + optional server status. */
export function buildHerdrSocketDoctorHints(
  health: HerdrSocketHealthProbe,
  options: { serverRunning?: boolean } = {}
): HerdrSocketDoctorHint[] {
  const hints: HerdrSocketDoctorHint[] = [];
  const serverRunning = options.serverRunning ?? false;

  if (!health.socketFileExists && !serverRunning) {
    hints.push({
      ...HERDR_SOCKET_ERROR_HINTS.ENOENT,
      detail: `${HERDR_SOCKET_ERROR_HINTS.ENOENT.detail} Path: ${health.socketPath}.`,
    });
  }

  if (health.socketFileExists && !health.connectable) {
    const stale: HerdrSocketDoctorHint = {
      code: "stale_socket",
      severity: "warn",
      summary: "Stale unix socket file",
      detail: `${health.socketPath} exists but Bun.connect could not reach a live listener.`,
      action: `Confirm no server is running, then: rm -f ${health.socketPath} && herdr server`,
    };
    hints.push(stale);
    const connectCode = health.connectErrorCode?.toUpperCase();
    if (connectCode === "ECONNREFUSED") {
      hints.push({
        ...HERDR_SOCKET_ERROR_HINTS.ECONNREFUSED,
        detail: `${HERDR_SOCKET_ERROR_HINTS.ECONNREFUSED.detail} Path: ${health.socketPath}.`,
      });
    } else if (connectCode === "ENOENT") {
      hints.push({
        ...HERDR_SOCKET_ERROR_HINTS.ENOENT,
        detail: `${HERDR_SOCKET_ERROR_HINTS.ENOENT.detail} Path: ${health.socketPath}.`,
      });
    } else if (connectCode === "EAGAIN") {
      hints.push({
        ...HERDR_SOCKET_ERROR_HINTS.EAGAIN,
        detail: `${HERDR_SOCKET_ERROR_HINTS.EAGAIN.detail} Path: ${health.socketPath}.`,
      });
    }
  }

  if (health.socketFileExists && health.connectable && serverRunning) {
    hints.push({
      code: "healthy",
      severity: "info",
      summary: "Unix socket healthy",
      detail: `${health.socketPath} exists and accepts connections.`,
    });
  }

  if (health.socketFileExists && health.connectable && !serverRunning) {
    hints.push({
      code: "healthy",
      severity: "info",
      summary: "Socket connectable but herdr status is not running",
      detail:
        "The socket accepts connections but `herdr status` did not report running — verify session routing (`--session` / HERDR_SOCKET_PATH).",
      action: "Use `herdr --session NAME status` when the project uses a named session.",
    });
  }

  if (!health.socketFileExists && serverRunning) {
    hints.push({
      code: "ENOENT",
      severity: "warn",
      summary: "Server reports running but socket file missing",
      detail: `herdr status says running but ${health.socketPath} was not found — session/path mismatch likely.`,
      action: "Align `herdr --session`, HERDR_SOCKET_PATH, and project `[herdr].session`.",
    });
  }

  return hints;
}

function dxDir(home = homeDir()): string {
  return new URL(".config/dx", Bun.pathToFileURL(`${home}/`)).pathname;
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
      env: withNoOrphansEnv({ ...Bun.env, PATH: resolveHerdrPanePath() }),
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
      output: error instanceof Error ? error.message : Bun.inspect(error),
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
    const result = Bun.spawnSync(["readlink", path], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return false;
    const target = result.stdout.toString().trim();
    const resolved = target.startsWith("/")
      ? target
      : Bun.fileURLToPath(new URL(target, new URL(".", Bun.pathToFileURL(path))));
    return resolved === expectedTarget;
  } catch {
    return false;
  }
}

function scanProjectProfiles(home = homeDir()) {
  const projects = readJson(new URL("projects.json", Bun.pathToFileURL(`${dxDir(home)}/`)).pathname) as {
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
    warnings.push(
      `config parse failed: ${error instanceof Error ? error.message : Bun.inspect(error)}`
    );
  }
  return warnings;
}

function checkSpawnWrappers(home = homeDir()) {
  const spawnDir = new URL(".local/bin", Bun.pathToFileURL(`${home}/`)).pathname;
  const missing: string[] = [];
  for (const agent of SPAWN_AGENTS) {
    const path = new URL(`herdr-spawn-${agent}`, Bun.pathToFileURL(`${spawnDir}/`)).pathname;
    if (!pathExists(path)) missing.push(agent);
  }
  return missing;
}

function checkShellModule(home = homeDir()) {
  const zshrc = new URL(".zshrc", Bun.pathToFileURL(`${home}/`)).pathname;
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
  const dxUrl = Bun.pathToFileURL(`${dx}/`);
  const homeUrl = Bun.pathToFileURL(`${home}/`);
  const manifestPath = new URL("herdr.json", dxUrl).pathname;
  const configPath = new URL("herdr.toml", dxUrl).pathname;
  const runtimeConfig = new URL(".config/herdr/config.toml", homeUrl).pathname;
  const skillPath = new URL(".config/agents/skills/herdr/SKILL.md", homeUrl).pathname;
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
  const shellModuleExists = pathExists(new URL(".config/shell/herdr.sh", homeUrl).pathname);
  const shellSourced = checkShellModule(home);
  const worktreesDir = expand(
    typeof manifest?.worktreesDir === "string" ? manifest.worktreesDir : "~/.herdr/worktrees",
    home
  );
  const parsedVersion = parseVersion(version.output);
  const socketTransportProbe = probeHerdrSocketTransport();
  const socketHealthProbe = await probeHerdrSocketHealth(socketTransportProbe.socketPath);

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
  let socketHints = buildHerdrSocketDoctorHints(socketHealthProbe);

  if (blockers.length === 0) {
    try {
      const session = resolveHerdrSession() || undefined;
      await ensureSessionRunning(session);

      status = run("herdr", ["status"]);
      serverRunning = /status:\s*running/.test(status.output);
      socketHints = buildHerdrSocketDoctorHints(socketHealthProbe, { serverRunning });
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

  for (const hint of socketHints) {
    if (hint.severity === "warn" || hint.severity === "error") {
      warnings.push(`${hint.summary}: ${hint.detail}`);
    }
  }

  const saturationHint = socketHints.find((h) => h.code === "EAGAIN");
  const socketRecoveryPlan = saturationHint
    ? buildHerdrSocketRecoveryPlan({
        code: "EAGAIN",
        serverRunning,
        socketPath: socketHealthProbe.socketPath,
      })
    : undefined;

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
      socketHealth: socketHealthProbe.socketFileExists
        ? socketHealthProbe.connectable
        : !serverRunning,
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
      socketHealthProbe,
      socketHints,
      socketErrorHints: HERDR_SOCKET_ERROR_HINTS,
      socketRecoveryPlan,
    },
    readiness: {
      ready: blockers.length === 0,
      blockers,
      warnings: [...new Set(warnings.filter(Boolean))],
    },
  };
}

export type HerdrDoctorReport = Awaited<ReturnType<typeof inspectHerdrDoctor>>;

export type FixSocketOptions = {
  dryRun?: boolean;
  errorText?: string;
  code?: HerdrCliProtocolErrorCode;
  liveDeps?: FixSocketLiveDeps;
};

/** @deprecated Use runFixSocket */
export type FixSocketDryRunOptions = FixSocketOptions;

export async function runFixSocket(options: FixSocketOptions = {}, home = homeDir()) {
  const socketTransportProbe = probeHerdrSocketTransport();
  const socketHealthProbe = await probeHerdrSocketHealth(socketTransportProbe.socketPath);

  let code: HerdrCliProtocolErrorCode = "EAGAIN";
  if (options.errorText) {
    const parsed = parseHerdrCliProtocolError(options.errorText);
    if (parsed && parsed.code !== "UNKNOWN") code = parsed.code;
  } else if (options.code) {
    code = options.code;
  } else if (socketHealthProbe.connectErrorCode === "ECONNREFUSED") {
    code = "ECONNREFUSED";
  } else if (socketHealthProbe.connectErrorCode === "EAGAIN") {
    code = "EAGAIN";
  }

  let serverRunning = false;
  let statusOutput = "";
  if (which("herdr")) {
    const status = run("herdr", ["status", "server"]);
    statusOutput = status.output;
    serverRunning = status.ok && /status:\s*running/.test(status.output);
  }

  const pgrep = probeHerdrServerProcesses();
  const dryRun = options.dryRun !== false;
  const steps = buildFixSocketPlanSnapshot({
    code,
    serverRunning,
    socketPath: socketHealthProbe.socketPath,
    serverPids: pgrep.processes,
    dryRun,
  });

  const taxonomyId =
    code === "EAGAIN"
      ? HERDR_SOCKET_SATURATION_TAXONOMY_ID
      : code === "ECONNREFUSED"
        ? "herdr_cli_attach_refused"
        : "unknown";

  const base = {
    schemaVersion: 1 as const,
    mode: "fix-socket" as const,
    generatedAt: new Date().toISOString(),
    home,
    code,
    taxonomyId,
    socketPath: socketHealthProbe.socketPath,
    socketHealthProbe,
    serverRunning,
    serverStatus: statusOutput || null,
    pgrep,
    steps,
  };

  if (dryRun) {
    return { ...base, dryRun: true as const, executed: false as const };
  }

  const live = await executeFixSocketLive(
    {
      code,
      socketPath: socketHealthProbe.socketPath,
      serverRunningBefore: serverRunning,
      pgrepBefore: pgrep.processes,
    },
    options.liveDeps
  );

  return {
    ...base,
    dryRun: false as const,
    executed: true as const,
    live,
  };
}

export async function runFixSocketDryRun(
  options: FixSocketOptions = {},
  home = homeDir()
): Promise<FixSocketReport> {
  return runFixSocket({ ...options, dryRun: options.dryRun ?? true }, home);
}

export type FixSocketReport = Awaited<ReturnType<typeof runFixSocket>>;
export type FixSocketDryRunReport = FixSocketReport;

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

export async function printFixSocketHuman(report: FixSocketReport): Promise<void> {
  await writeOut(`Herdr Doctor — fix-socket (${report.dryRun ? "dry-run" : "live"})`);
  await writeOut(`Generated: ${report.generatedAt}`);
  await writeOut(`Taxonomy: ${report.taxonomyId} (${report.code})`);
  await writeOut(`Socket: ${report.socketPath}`);
  await writeOut(`Server running: ${report.serverRunning ? "yes" : "no"}`);
  await writeOut(`pgrep: ${report.pgrep.pgrepCommand}`);
  if (report.pgrep.processes.length) {
    for (const proc of report.pgrep.processes) {
      await writeOut(`  pid ${proc.pid}: ${proc.command}`);
    }
  } else {
    await writeOut("  (no herdr server PID resolved)");
  }
  await writeOut("");
  await writeOut("Recovery plan:");
  for (const step of report.steps) {
    const tag = step.destructive ? "destructive" : "safe";
    await writeOut(`  ${step.order}. [${tag}] ${step.action}`);
    if (step.command) writeOut(`     cmd: ${step.command}`);
    if (step.wouldRun) writeOut(`     ${step.wouldRun}`);
    if (step.skippedReason) writeOut(`     skip: ${step.skippedReason}`);
  }
  if (report.executed && report.live) {
    await writeOut("");
    await writeOut("Live execution:");
    for (const action of report.live.actions) {
      await writeOut(
        `  [${action.outcome}] ${action.phase}${action.command ? `: ${action.command}` : ""}`
      );
      if (action.detail) writeOut(`    ${action.detail}`);
    }
    await writeOut(`Final server: ${report.live.finalServerRunning ? "running" : "not running"}`);
  } else {
    await writeOut("");
    await writeOut("No commands were executed. Re-run with --live to execute.");
  }
}

export const printFixSocketDryRunHuman = printFixSocketHuman;

export async function printHerdrDoctorHuman(report: HerdrDoctorReport): Promise<void> {
  await writeOut("Herdr Doctor");
  await writeOut(`Generated: ${report.generatedAt}`);
  await writeOut("");
  for (const [name, ok] of Object.entries(report.checks)) {
    await writeOut(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
  await writeOut("");
  if (report.details.version) writeOut(`Version: ${report.details.version}`);
  if (report.details.binary) writeOut(`Binary: ${report.details.binary}`);
  if (report.details.paneBinary) writeOut(`Pane CLI: ${report.details.paneBinary}`);
  if (report.details.socketTransportProbe) {
    const probe = report.details.socketTransportProbe;
    await writeOut(
      `Socket transport: ${probe.transport} (ws+unix: ${probe.wsSupported ? "yes" : "no"}, path: ${probe.socketPath})`
    );
  }
  if (report.details.socketHealthProbe) {
    const health = report.details.socketHealthProbe;
    await writeOut(
      `Socket health: file=${health.socketFileExists ? "yes" : "no"}, connectable=${health.connectable ? "yes" : "no"} (${health.socketPath})`
    );
  }
  if (report.details.socketHints?.length) {
    for (const hint of report.details.socketHints) {
      await writeOut(`Socket hint [${hint.code}]: ${hint.summary}`);
      if (hint.action) writeOut(`  action: ${hint.action}`);
    }
  }
  if (report.details.socketRecoveryPlan?.length) {
    await writeOut("Socket recovery plan (read-only — run steps manually):");
    for (const step of report.details.socketRecoveryPlan) {
      const tag = step.destructive ? "destructive" : "safe";
      await writeOut(`  ${step.order}. [${tag}] ${step.action}`);
      if (step.command) writeOut(`     ${step.command}`);
    }
  }
  await writeOut(`Config: ${report.details.configPath}`);
  if (report.details.fixes?.length) writeOut(`Fixes: ${report.details.fixes.join("; ")}`);
  await writeOut("");
  await writeOut(`Status: ${report.readiness.ready ? "ready" : "blocked"}`);
  if (report.readiness.blockers.length) {
    await writeOut(`Blockers: ${report.readiness.blockers.join("; ")}`);
  }
  if (report.readiness.warnings.length) {
    await writeOut(`Warnings: ${report.readiness.warnings.join("; ")}`);
  }
}
