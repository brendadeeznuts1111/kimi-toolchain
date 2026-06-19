import { pathExists, readText } from "./bun-io.ts";

import { TOML } from "bun";
import type { ReportConditionClause } from "./condition-evaluator.ts";
import { parseWhenTable } from "./condition-evaluator.ts";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { herdrConfigTomlPath, homeDir } from "./paths.ts";
import { join } from "path";

// ── Orchestrator event allowlist ────────────────────────────────────────

export const DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST = [
  "workspace.updated",
  "reviewer.feedback.processed",
  "pane.agent_status_changed",
  "effect.gates.changed",
  "git.ref.changed",
] as const;

export const DEFAULT_GIT_REF_COOLDOWN_MS = 5_000;
export const MIN_GIT_REF_COOLDOWN_MS = 1_000;
export const MAX_GIT_REF_COOLDOWN_MS = 30_000;

export interface HerdrOrchestratorEventsConfig {
  enabled: boolean;
  debounceMs: number;
  /** Null = default allowlist. Empty array = accept all known events. */
  allowlist: string[] | null;
  /** Poll .git/HEAD for commits while agents are running. */
  watchGit: boolean;
  /** Suppress duplicate git.ref.changed for the same HEAD within this window. */
  gitRefCooldownMs: number;
}

export function clampGitRefCooldownMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GIT_REF_COOLDOWN_MS;
  return Math.min(MAX_GIT_REF_COOLDOWN_MS, Math.max(MIN_GIT_REF_COOLDOWN_MS, value));
}

export function parseGitRefCooldownMs(section: Record<string, unknown>): number {
  const camel = section.gitRefCooldownMs;
  const snake = section.git_ref_cooldown_ms;
  const raw =
    typeof camel === "number"
      ? camel
      : typeof snake === "number"
        ? snake
        : DEFAULT_GIT_REF_COOLDOWN_MS;
  return clampGitRefCooldownMs(raw);
}

// ── Handoff rules ───────────────────────────────────────────────────────

export interface SpawnFallback {
  /** Remote host label from [herdr.orchestrator.remote_hosts]. */
  host: string;
  /** Session to target (defaults to rule's to_session or from_session). */
  session?: string;
  /** CLI to launch (e.g. "kimi", "codex"). */
  agentCli: string;
  /** Agent label (derived from to_agent if not provided). */
  label?: string;
  /** Workspace for the new agent. */
  workspace?: string;
  /** Working directory for the agent process. */
  cwd?: string;
  /** Split direction. */
  split?: string;
  /** Tab to place the agent in. */
  tab?: string;
}

export interface HandoffRule {
  /** Session name (default: current session). */
  fromSession?: string;
  fromWorkspace: string;
  fromAgent: string;
  /**
   * Legacy string condition: "done" | "blocked > 5m" | probe:/finish-work: prefixes.
   * Optional when `when` is set (stored as `report:when` internally).
   */
  condition: string;
  /** Report-field AND clauses — e.g. finishWorkReport.outcome = "clean". */
  when?: ReportConditionClause[];
  /** Target session (default: same as fromSession or current session). */
  toSession?: string;
  toWorkspace: string;
  toAgent: string;
  /**
   * How to pick the target pane when multiple agents match `to_agent` in `to_workspace`.
   * - `fixed` (default): first deterministic match by pane id
   * - `least_busy`: idle > done > working among name/label matches in `to_workspace`
   * Legacy: `to_agent = "least_busy"` / `least_busy:<label>` implies global least-busy (ignores `to_agent` name).
   */
  targetStrategy?: HandoffTargetStrategy;
  /** If true, spawn the target agent on the remote host if it's not already running. */
  spawnIfMissing?: boolean;
  /** Auto-spawn config — creates an agent on a remote host when no target candidate exists. */
  spawnFallback?: SpawnFallback;
}

export type HandoffTargetStrategy = "fixed" | "least_busy";

export type HandoffCondition =
  | { kind: "status"; status: string; minSeconds: number }
  | { kind: "probe"; probeId: string };

export function parseTargetStrategy(raw: unknown): HandoffTargetStrategy | undefined {
  if (raw === "least_busy" || raw === "fixed") return raw;
  return undefined;
}

/** Resolve strategy from explicit field or legacy least_busy `to_agent` syntax. */
export function resolveTargetStrategy(rule: HandoffRule): HandoffTargetStrategy {
  if (rule.targetStrategy) return rule.targetStrategy;
  if (rule.toAgent === "least_busy" || rule.toAgent.startsWith("least_busy:")) {
    return "least_busy";
  }
  return "fixed";
}

export function isLegacyGlobalLeastBusyTarget(toAgent: string): boolean {
  return toAgent === "least_busy" || toAgent.startsWith("least_busy:");
}

export function parseCondition(condition: string): HandoffCondition | null {
  const trimmed = condition.trim();
  if (trimmed.startsWith("probe:")) {
    const probeId = trimmed.slice("probe:".length).trim();
    return probeId ? { kind: "probe", probeId } : null;
  }
  if (trimmed.startsWith("finish-work:")) {
    return { kind: "probe", probeId: trimmed };
  }
  if (trimmed === "done") return { kind: "status", status: "done", minSeconds: 0 };
  const match = trimmed.match(/^(blocked|idle)\s*>\s*(\d+)\s*m(in(ute)?s?)?$/);
  if (match) {
    return { kind: "status", status: match[1]!, minSeconds: parseInt(match[2]!, 10) * 60 };
  }
  return null;
}

/** Parse one `[[herdr.orchestrator.handoff_rules]]` table row. */
export function parseHandoffRuleEntry(entry: unknown): HandoffRule | null {
  if (!entry || typeof entry !== "object") return null;
  const r = entry as Record<string, unknown>;
  const fromSession = typeof r.from_session === "string" ? r.from_session : undefined;
  const fromWorkspace = typeof r.from_workspace === "string" ? r.from_workspace : "";
  const fromAgent = typeof r.from_agent === "string" ? r.from_agent : "";
  const condition = typeof r.condition === "string" ? r.condition.trim() : "";
  const when = parseWhenTable(r.when) ?? undefined;
  const toSession = typeof r.to_session === "string" ? r.to_session : undefined;
  const toWorkspace = typeof r.to_workspace === "string" ? r.to_workspace : "";
  const toAgent = typeof r.to_agent === "string" ? r.to_agent : "";
  const targetStrategy = parseTargetStrategy(r.target_strategy);
  const spawnIfMissing = typeof r.spawn_if_missing === "boolean" ? r.spawn_if_missing : undefined;

  let spawnFallback: SpawnFallback | undefined;
  if (r.spawn_fallback && typeof r.spawn_fallback === "object") {
    const sf = r.spawn_fallback as Record<string, unknown>;
    const host = typeof sf.host === "string" ? sf.host : "";
    const agentCli = typeof sf.agent_cli === "string" ? sf.agent_cli : "";
    if (host && agentCli) {
      spawnFallback = {
        host,
        agentCli,
        session: typeof sf.session === "string" ? sf.session : undefined,
        label: typeof sf.label === "string" ? sf.label : undefined,
        workspace: typeof sf.workspace === "string" ? sf.workspace : undefined,
        cwd: typeof sf.cwd === "string" ? sf.cwd : undefined,
        split: typeof sf.split === "string" ? sf.split : undefined,
        tab: typeof sf.tab === "string" ? sf.tab : undefined,
      };
    }
  }

  const resolvedCondition = condition || (when ? "report:when" : "");
  if (!fromWorkspace || !fromAgent || !resolvedCondition || !toWorkspace || !toAgent) {
    return null;
  }

  return {
    fromSession,
    fromWorkspace,
    fromAgent,
    condition: resolvedCondition,
    when,
    toSession,
    toWorkspace,
    toAgent,
    targetStrategy,
    spawnIfMissing,
    spawnFallback,
  };
}

// ── Remote SSH types ────────────────────────────────────────────────────

/** Per-host SSH connection options. All fields except `host` are optional. */
export interface RemoteHostConfig {
  host: string;
  port?: number;
  user?: string;
  /** Path to SSH identity / private key. */
  identityFile?: string;
  /** Per-host command timeout in seconds (converted to ms internally). */
  timeout?: number;
  /** If true, adds -o IdentitiesOnly=yes so SSHAgent keys are skipped. */
  identitiesOnly?: boolean;
  /** 'yes' | 'no' | 'accept-new' → -o StrictHostKeyChecking=… */
  strictHostKeyChecking?: "yes" | "no" | "accept-new";
  /** Path to a custom known_hosts file. */
  userKnownHostsFile?: string;
  /** Seconds between keep-alive pings (0 = disabled). */
  serverAliveInterval?: number;
  /** Max unanswered keep-alive pings before disconnect. */
  serverAliveCountMax?: number;
  /** 'yes' | 'auto' | 'no' → -o ControlMaster=… */
  controlMaster?: "yes" | "auto" | "no";
  /** Socket path for ControlMaster (e.g. ~/.ssh/control/%C). */
  controlPath?: string;
  /** Seconds to keep control socket alive after exit. */
  controlPersist?: number;
  /** Enable SSH compression (-o Compression=yes). */
  compression?: boolean;
  /** Bastion / jump host string (e.g. user@gateway:22). */
  proxyJump?: string;
}

/** Global defaults applied to all remote hosts unless overridden per-host. */
export interface RemoteDefaults {
  /** Command timeout in seconds. */
  timeout?: number;
  /** Use BatchMode=yes (prevent interactive prompts). */
  batchMode?: boolean;
  /** SSH ConnectTimeout in seconds. */
  connectTimeout?: number;
  /** Path to SSH identity / private key. */
  identityFile?: string;
  /** If true, adds -o IdentitiesOnly=yes. */
  identitiesOnly?: boolean;
  /** 'yes' | 'no' | 'accept-new'. */
  strictHostKeyChecking?: "yes" | "no" | "accept-new";
  /** Path to a custom known_hosts file. */
  userKnownHostsFile?: string;
  /** Seconds between keep-alive pings. */
  serverAliveInterval?: number;
  /** Max unanswered keep-alive pings. */
  serverAliveCountMax?: number;
  /** 'yes' | 'auto' | 'no'. */
  controlMaster?: "yes" | "auto" | "no";
  /** Socket path for ControlMaster. */
  controlPath?: string;
  /** Seconds to keep control socket alive after exit. */
  controlPersist?: number;
  /** Enable SSH compression. */
  compression?: boolean;
  /** Bastion / jump host string. */
  proxyJump?: string;
}

/** Fully-resolved remote host config ready for SSH command construction. */
export interface ResolvedRemoteHost {
  /** Logical label from the TOML key. */
  name: string;
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  /** Where the identity file came from. */
  identityFileSource: "explicit" | "discovered" | "env" | "none";
  /** Command timeout in milliseconds. */
  timeout: number;
  batchMode: boolean;
  connectTimeout: number;
  identitiesOnly: boolean;
  strictHostKeyChecking: "yes" | "no" | "accept-new";
  userKnownHostsFile?: string;
  serverAliveInterval: number;
  serverAliveCountMax: number;
  controlMaster: "yes" | "auto" | "no";
  controlPath?: string;
  controlPersist?: number;
  compression: boolean;
  proxyJump?: string;
}

// ── Env-var overrides ───────────────────────────────────────────────────

/** HERDR_SSH_* env var names read by parseEnvOverrides (SSOT for tests and tooling). */
export const HERDR_SSH_ENV_KEYS = [
  "HERDR_SSH_PORT",
  "HERDR_SSH_USER",
  "HERDR_SSH_TIMEOUT",
  "HERDR_SSH_BATCH_MODE",
  "HERDR_SSH_CONNECT_TIMEOUT",
  "HERDR_SSH_IDENTITY_FILE",
  "HERDR_SSH_IDENTITIES_ONLY",
  "HERDR_SSH_STRICT_HOST_KEY_CHECKING",
  "HERDR_SSH_USER_KNOWN_HOSTS_FILE",
  "HERDR_SSH_SERVER_ALIVE_INTERVAL",
  "HERDR_SSH_SERVER_ALIVE_COUNT_MAX",
  "HERDR_SSH_CONTROL_MASTER",
  "HERDR_SSH_CONTROL_PATH",
  "HERDR_SSH_CONTROL_PERSIST",
  "HERDR_SSH_COMPRESSION",
  "HERDR_SSH_PROXY_JUMP",
] as const;

/** Keys are HERDR_SSH_<NAME> env vars. Values override EVERYTHING. */
interface EnvOverrides {
  port?: number;
  user?: string;
  timeout?: number;
  batchMode?: boolean;
  connectTimeout?: number;
  identityFile?: string;
  identitiesOnly?: boolean;
  strictHostKeyChecking?: "yes" | "no" | "accept-new";
  userKnownHostsFile?: string;
  serverAliveInterval?: number;
  serverAliveCountMax?: number;
  controlMaster?: "yes" | "auto" | "no";
  controlPath?: string;
  controlPersist?: number;
  compression?: boolean;
  proxyJump?: string;
}

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return undefined;
}

function parseHostKeyEnv(value: string | undefined): "yes" | "no" | "accept-new" | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "yes" || lower === "no" || lower === "accept-new") {
    return lower as "yes" | "no" | "accept-new";
  }
  return undefined;
}

function parseControlMasterEnv(value: string | undefined): "yes" | "auto" | "no" | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "yes" || lower === "auto" || lower === "no") {
    return lower as "yes" | "auto" | "no";
  }
  return undefined;
}

function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

/**
 * Read HERDR_SSH_* environment variables.
 * These are top-priority — they override everything including per-host TOML.
 */
export function parseEnvOverrides(): EnvOverrides {
  const overrides: EnvOverrides = {};
  const port = parsePositiveIntEnv(Bun.env.HERDR_SSH_PORT);
  if (port !== undefined) overrides.port = port;
  const user = Bun.env.HERDR_SSH_USER?.trim();
  if (user) overrides.user = user;
  const to = parsePositiveIntEnv(Bun.env.HERDR_SSH_TIMEOUT);
  if (to !== undefined) overrides.timeout = to * 1000; // seconds → ms
  const bm = parseBoolEnv(Bun.env.HERDR_SSH_BATCH_MODE);
  if (bm !== undefined) overrides.batchMode = bm;
  const ct = parsePositiveIntEnv(Bun.env.HERDR_SSH_CONNECT_TIMEOUT);
  if (ct !== undefined) overrides.connectTimeout = ct;
  const id = Bun.env.HERDR_SSH_IDENTITY_FILE?.trim();
  if (id) overrides.identityFile = id;
  const io = parseBoolEnv(Bun.env.HERDR_SSH_IDENTITIES_ONLY);
  if (io !== undefined) overrides.identitiesOnly = io;
  const shk = parseHostKeyEnv(Bun.env.HERDR_SSH_STRICT_HOST_KEY_CHECKING);
  if (shk) overrides.strictHostKeyChecking = shk;
  const ukf = Bun.env.HERDR_SSH_USER_KNOWN_HOSTS_FILE?.trim();
  if (ukf) overrides.userKnownHostsFile = ukf;
  const sai = parsePositiveIntEnv(Bun.env.HERDR_SSH_SERVER_ALIVE_INTERVAL);
  if (sai !== undefined) overrides.serverAliveInterval = sai;
  const scm = parsePositiveIntEnv(Bun.env.HERDR_SSH_SERVER_ALIVE_COUNT_MAX);
  if (scm !== undefined) overrides.serverAliveCountMax = scm;
  const cm = parseControlMasterEnv(Bun.env.HERDR_SSH_CONTROL_MASTER);
  if (cm) overrides.controlMaster = cm;
  const cp = Bun.env.HERDR_SSH_CONTROL_PATH?.trim();
  if (cp) overrides.controlPath = cp;
  const cpersist = parsePositiveIntEnv(Bun.env.HERDR_SSH_CONTROL_PERSIST);
  if (cpersist !== undefined) overrides.controlPersist = cpersist;
  const comp = parseBoolEnv(Bun.env.HERDR_SSH_COMPRESSION);
  if (comp !== undefined) overrides.compression = comp;
  const pj = Bun.env.HERDR_SSH_PROXY_JUMP?.trim();
  if (pj) overrides.proxyJump = pj;
  return overrides;
}

// ── Identity file discovery ─────────────────────────────────────────────

const KNOWN_IDENTITY_FILES = ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] as const;

/**
 * Try common identity file paths in ~/.ssh.
 * Returns the first path that exists on disk, or undefined if none exist.
 */
export function discoverIdentityFile(): string | undefined {
  const home = homeDir();
  const sshDir = join(home, ".ssh");
  for (const name of KNOWN_IDENTITY_FILES) {
    const path = join(sshDir, name);
    if (pathExists(path)) return path;
  }
  return undefined;
}

// ── Defaults ────────────────────────────────────────────────────────────

const HARDCODED_DEFAULTS: Omit<
  ResolvedRemoteHost,
  "name" | "host" | "port" | "user" | "identityFile" | "identityFileSource"
> = {
  timeout: 15_000,
  batchMode: true,
  connectTimeout: 5,
  identitiesOnly: false,
  strictHostKeyChecking: "accept-new",
  serverAliveInterval: 0,
  serverAliveCountMax: 3,
  controlMaster: "no",
  compression: false,
};

// ── Normalization ───────────────────────────────────────────────────────

function normalizeHostKeyChecking(value: string | undefined): "yes" | "no" | "accept-new" {
  if (value === "yes" || value === "no" || value === "accept-new") return value;
  return HARDCODED_DEFAULTS.strictHostKeyChecking;
}

function normalizeControlMaster(value: string | undefined): "yes" | "auto" | "no" {
  if (value === "yes" || value === "auto" || value === "no") return value;
  return HARDCODED_DEFAULTS.controlMaster;
}

/**
 * Normalize a map of label → (string | RemoteHostConfig) into label → ResolvedRemoteHost.
 *
 * Tiered override priority (lowest → highest):
 *  1. HARDCODED_DEFAULTS
 *  2. [herdr.orchestrator.remote_defaults] TOML section
 *  3. Per-host [herdr.orchestrator.remote_hosts.<name>] TOML
 *  4. HERDR_SSH_* environment variables (top priority)
 *
 * After resolution, if no identity file was explicitly set, the function
 * attempts auto-discovery in ~/.ssh/.
 */
export function normalizeRemoteHostConfig(
  hosts: Record<string, string | RemoteHostConfig>,
  tomlDefaults?: RemoteDefaults
): Record<string, ResolvedRemoteHost> {
  const envOverrides = parseEnvOverrides();

  // Merge TOML remote_defaults into hardcoded defaults
  const mergedDefaults = { ...HARDCODED_DEFAULTS };
  if (tomlDefaults) {
    if (tomlDefaults.timeout !== undefined) mergedDefaults.timeout = tomlDefaults.timeout * 1000;
    if (tomlDefaults.batchMode !== undefined) mergedDefaults.batchMode = tomlDefaults.batchMode;
    if (tomlDefaults.connectTimeout !== undefined)
      mergedDefaults.connectTimeout = tomlDefaults.connectTimeout;
    if (tomlDefaults.identitiesOnly !== undefined)
      mergedDefaults.identitiesOnly = tomlDefaults.identitiesOnly;
    if (tomlDefaults.strictHostKeyChecking !== undefined) {
      mergedDefaults.strictHostKeyChecking = normalizeHostKeyChecking(
        tomlDefaults.strictHostKeyChecking
      );
    }
    if (tomlDefaults.userKnownHostsFile !== undefined) {
      (mergedDefaults as Record<string, unknown>).userKnownHostsFile =
        tomlDefaults.userKnownHostsFile;
    }
    if (tomlDefaults.serverAliveInterval !== undefined)
      mergedDefaults.serverAliveInterval = tomlDefaults.serverAliveInterval;
    if (tomlDefaults.serverAliveCountMax !== undefined)
      mergedDefaults.serverAliveCountMax = tomlDefaults.serverAliveCountMax;
    if (tomlDefaults.controlMaster !== undefined) {
      mergedDefaults.controlMaster = normalizeControlMaster(tomlDefaults.controlMaster);
    }
    if (tomlDefaults.controlPath !== undefined) {
      (mergedDefaults as Record<string, unknown>).controlPath = tomlDefaults.controlPath;
    }
    if (tomlDefaults.controlPersist !== undefined) {
      (mergedDefaults as Record<string, unknown>).controlPersist = tomlDefaults.controlPersist;
    }
    if (tomlDefaults.compression !== undefined)
      mergedDefaults.compression = tomlDefaults.compression;
    if (tomlDefaults.proxyJump !== undefined) {
      (mergedDefaults as Record<string, unknown>).proxyJump = tomlDefaults.proxyJump;
    }
  }

  const resolved: Record<string, ResolvedRemoteHost> = {};
  const discoveredIdFile = discoverIdentityFile();

  for (const [label, value] of Object.entries(hosts)) {
    // Start with merged defaults
    const base: Omit<
      ResolvedRemoteHost,
      "name" | "host" | "port" | "user" | "identityFile" | "identityFileSource"
    > = {
      ...mergedDefaults,
    };

    // Determine host / port / user / identityFile from per-host config
    let host: string;
    let port: number | undefined;
    let user: string | undefined;
    let identityFile: string | undefined;
    let identityFileSource: ResolvedRemoteHost["identityFileSource"] = "none";

    if (typeof value === "string") {
      host = value;
    } else {
      host = value.host;
      port = value.port;
      user = value.user;

      // Per-host TOML overrides
      if (value.timeout !== undefined)
        (base as Record<string, unknown>).timeout = value.timeout * 1000;
      if (value.identitiesOnly !== undefined) base.identitiesOnly = value.identitiesOnly;
      if (value.strictHostKeyChecking !== undefined) {
        base.strictHostKeyChecking = normalizeHostKeyChecking(value.strictHostKeyChecking);
      }
      if (value.userKnownHostsFile !== undefined)
        (base as Record<string, unknown>).userKnownHostsFile = value.userKnownHostsFile;
      if (value.serverAliveInterval !== undefined)
        base.serverAliveInterval = value.serverAliveInterval;
      if (value.serverAliveCountMax !== undefined)
        base.serverAliveCountMax = value.serverAliveCountMax;
      if (value.controlMaster !== undefined) {
        base.controlMaster = normalizeControlMaster(value.controlMaster);
      }
      if (value.controlPath !== undefined)
        (base as Record<string, unknown>).controlPath = value.controlPath;
      if (value.controlPersist !== undefined)
        (base as Record<string, unknown>).controlPersist = value.controlPersist;
      if (value.compression !== undefined) base.compression = value.compression;
      if (value.proxyJump !== undefined)
        (base as Record<string, unknown>).proxyJump = value.proxyJump;

      // Per-host identityFile overrides TOML defaults
      if (value.identityFile) {
        identityFile = value.identityFile;
        identityFileSource = "explicit";
      }
    }

    // TOML default identity file (if not already set by per-host)
    if (!identityFile && tomlDefaults?.identityFile) {
      identityFile = tomlDefaults.identityFile;
      identityFileSource = "explicit";
    }

    // Env var overrides (top priority)
    if (envOverrides.timeout !== undefined)
      (base as Record<string, unknown>).timeout = envOverrides.timeout; // already ms
    if (envOverrides.batchMode !== undefined) base.batchMode = envOverrides.batchMode;
    if (envOverrides.connectTimeout !== undefined)
      base.connectTimeout = envOverrides.connectTimeout;
    if (envOverrides.identitiesOnly !== undefined)
      base.identitiesOnly = envOverrides.identitiesOnly;
    if (envOverrides.strictHostKeyChecking !== undefined)
      base.strictHostKeyChecking = normalizeHostKeyChecking(envOverrides.strictHostKeyChecking);
    if (envOverrides.userKnownHostsFile !== undefined)
      (base as Record<string, unknown>).userKnownHostsFile = envOverrides.userKnownHostsFile;
    if (envOverrides.serverAliveInterval !== undefined)
      base.serverAliveInterval = envOverrides.serverAliveInterval;
    if (envOverrides.serverAliveCountMax !== undefined)
      base.serverAliveCountMax = envOverrides.serverAliveCountMax;
    if (envOverrides.controlMaster !== undefined)
      base.controlMaster = normalizeControlMaster(envOverrides.controlMaster);
    if (envOverrides.controlPath !== undefined)
      (base as Record<string, unknown>).controlPath = envOverrides.controlPath;
    if (envOverrides.compression !== undefined) base.compression = envOverrides.compression;
    if (envOverrides.proxyJump !== undefined)
      (base as Record<string, unknown>).proxyJump = envOverrides.proxyJump;
    if (envOverrides.controlPersist !== undefined)
      (base as Record<string, unknown>).controlPersist = envOverrides.controlPersist;
    if (envOverrides.port !== undefined) port = envOverrides.port;
    if (envOverrides.user !== undefined) user = envOverrides.user;
    if (envOverrides.identityFile) {
      identityFile = envOverrides.identityFile;
      identityFileSource = "env";
    }

    // Auto-discovery: if no identity file was set anywhere, try common paths
    if (!identityFile && discoveredIdFile) {
      identityFile = discoveredIdFile;
      identityFileSource = "discovered";
    }

    resolved[label] = {
      name: label,
      host,
      port,
      user,
      identityFile,
      identityFileSource,
      ...base,
    } as ResolvedRemoteHost;
  }

  return resolved;
}

// ── Validation warnings ─────────────────────────────────────────────────

export interface ValidationWarning {
  host: string;
  severity: "warn" | "info";
  message: string;
}

/**
 * Validate a resolved remote host config for common issues:
 * - Missing identity file (when explicitly configured)
 * - Very low timeout / connect timeout
 * - Missing ProxyJump when controlMaster is auto
 * - Compression with controlMaster
 * - Risky StrictHostKeyChecking=no
 * - identityFileSource being "none" (no keys at all)
 *
 * Returns an array of warnings; empty array = no issues.
 */
export function validateRemoteHostConfig(
  resolved: Record<string, ResolvedRemoteHost>
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const [label, r] of Object.entries(resolved)) {
    // Identity file checks
    if (r.identityFileSource === "none") {
      warnings.push({
        host: label,
        severity: "warn",
        message: `no identity file found — SSH may prompt for password (set identity_file or use ssh-agent)`,
      });
    }
    if (r.identityFileSource === "discovered") {
      warnings.push({
        host: label,
        severity: "info",
        message: `using auto-discovered identity file: ${r.identityFile}`,
      });
    }

    // Timeout sanity
    if (r.connectTimeout < 3) {
      warnings.push({
        host: label,
        severity: "warn",
        message: `connectTimeout=${r.connectTimeout}s is very low — connections may fail under load`,
      });
    }
    if (r.timeout < 5_000) {
      warnings.push({
        host: label,
        severity: "warn",
        message: `timeout=${r.timeout}ms is under 5s — long-running herdr commands may be killed`,
      });
    }

    // Security: StrictHostKeyChecking=no
    if (r.strictHostKeyChecking === "no") {
      warnings.push({
        host: label,
        severity: "warn",
        message: `StrictHostKeyChecking=no disables host key verification — use "accept-new" or "yes"`,
      });
    }

    // ControlMaster missing controlPath
    if (r.controlMaster !== "no" && !r.controlPath) {
      warnings.push({
        host: label,
        severity: "warn",
        message: `controlMaster=${r.controlMaster} but no controlPath set — multiplexing disabled`,
      });
    }

    // ProxyJump + ControlMaster = often needs extra path
    if (r.proxyJump && r.controlMaster !== "no" && !r.controlPath) {
      warnings.push({
        host: label,
        severity: "info",
        message: `proxyJump + controlMaster works best with controlPath set to ~/.ssh/control/%C`,
      });
    }

    // IdentitiesOnly without identityFile
    if (r.identitiesOnly && !r.identityFile) {
      warnings.push({
        host: label,
        severity: "info",
        message: `identitiesOnly=yes but no identityFile set — only ssh-agent keys will be tried`,
      });
    }
  }

  return warnings;
}

// ── Herdr app config reader ────────────────────────────────────────────

/** Structure of ~/.config/herdr/config.toml relevant to remote operations. */
export interface HerdrNotifyPluginConfig {
  enabled?: boolean;
  webhookUrl?: string;
  onHandoff?: boolean;
  onSpawn?: boolean;
  onError?: boolean;
}

export interface HerdrAppConfig {
  onboarding?: boolean;
  update?: {
    channel?: "stable" | "preview";
  };
  remote?: {
    manageSshConfig?: boolean;
  };
  plugins?: {
    notify?: HerdrNotifyPluginConfig;
  };
}

export function parseHerdrAppConfig(doc: Record<string, unknown>): HerdrAppConfig {
  const result: HerdrAppConfig = {};

  if (typeof doc.onboarding === "boolean") result.onboarding = doc.onboarding;

  const upd = doc.update;
  if (upd && typeof upd === "object") {
    const u = upd as Record<string, unknown>;
    if (u.channel === "stable" || u.channel === "preview") {
      result.update = { channel: u.channel };
    }
  }

  const rem = doc.remote;
  if (rem && typeof rem === "object") {
    const r = rem as Record<string, unknown>;
    if (typeof r.manage_ssh_config === "boolean") {
      result.remote = { manageSshConfig: r.manage_ssh_config };
    }
  }

  const plugins = doc.plugins;
  if (plugins && typeof plugins === "object") {
    const notifyRaw = (plugins as Record<string, unknown>).notify;
    if (notifyRaw && typeof notifyRaw === "object") {
      const n = notifyRaw as Record<string, unknown>;
      const notify: HerdrNotifyPluginConfig = {};
      if (typeof n.enabled === "boolean") notify.enabled = n.enabled;
      if (typeof n.webhook_url === "string") notify.webhookUrl = n.webhook_url;
      if (typeof n.on_handoff === "boolean") notify.onHandoff = n.on_handoff;
      if (typeof n.on_spawn === "boolean") notify.onSpawn = n.on_spawn;
      if (typeof n.on_error === "boolean") notify.onError = n.on_error;
      result.plugins = { notify };
    }
  }

  return result;
}

/**
 * Read notification defaults from Herdr's [plugins.notify] plugin config.
 * Project-level [herdr.orchestrator.notifications] overrides these values.
 */
export function readHerdrNotifyDefaults(): NotificationsConfig {
  const app = readHerdrAppConfig();
  const notify = app?.plugins?.notify;
  if (!notify || notify.enabled === false) return { enabled: false };

  const defaults: NotificationsConfig = {};
  if (notify.webhookUrl) defaults.webhookUrl = notify.webhookUrl;
  if (notify.onHandoff !== undefined) defaults.onHandoff = notify.onHandoff;
  if (notify.onSpawn !== undefined) defaults.onSpawn = notify.onSpawn;
  if (notify.onError !== undefined) defaults.onError = notify.onError;
  return defaults;
}

export function mergeNotifications(
  primary: NotificationsConfig,
  fallback: NotificationsConfig
): NotificationsConfig {
  // When the fallback explicitly disabled notifications, don't use any of its fields
  if (fallback.enabled === false) {
    return { enabled: false, ...primary };
  }
  return {
    enabled: primary.enabled ?? fallback.enabled,
    webhookUrl: primary.webhookUrl ?? fallback.webhookUrl,
    onHandoff: primary.onHandoff ?? fallback.onHandoff,
    onSpawn: primary.onSpawn ?? fallback.onSpawn,
    onError: primary.onError ?? fallback.onError,
  };
}

/**
 * Read and parse ~/.config/herdr/config.toml.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readHerdrAppConfig(): HerdrAppConfig | null {
  const configPath = herdrConfigTomlPath();
  if (!pathExists(configPath)) return null;
  try {
    const raw = readText(configPath);
    const doc = TOML.parse(raw) as Record<string, unknown>;
    return parseHerdrAppConfig(doc);
  } catch {
    return null;
  }
}

/**
 * Read Herdr app config and extract [remote] section as RemoteDefaults.
 * Returns empty defaults if no Herdr config or no [remote] section exists.
 */
export function readHerdrRemoteDefaults(): RemoteDefaults {
  const app = readHerdrAppConfig();
  if (!app?.remote) return {};
  const defaults: RemoteDefaults = {};
  if (app.remote.manageSshConfig === false) {
    // When Herdr's manage_ssh_config is off, its bridge no longer injects
    // fallback ServerAliveInterval / ServerAliveCountMax. We supply our own
    // so long-running herdr commands don't drop.
    defaults.batchMode = true;
    defaults.serverAliveInterval = 60;
    defaults.serverAliveCountMax = 3;
  }
  return defaults;
}

// ── Orchestrator config ─────────────────────────────────────────────────

/** Dashboard WebView / HTTP server timing (SSE poll + stale heartbeat overlay). */
export interface HerdrOrchestratorDashboardConfig {
  /** Mark agents stale when heartbeat older than this (ms). */
  staleMs: number;
  /** Server SSE agent-discovery poll interval (ms). */
  ssePollMs: number;
  /** Handoffs/rules browser poll interval (ms). */
  pollHintMs: number;
  /** Launch Bun.WebView shell when `herdr-orchestrator dashboard` runs without mode flags. */
  webview?: boolean;
  /** Bun.WebView dataStore persistence (default profile under ~/.kimi-code/var/). */
  persistProfile?: boolean;
  /** Override persistent dataStore directory (implies persist unless ephemeral forced). */
  profileDir?: string;
  /** Examples tab iframe base URL (env HERDR_EXAMPLES_DASHBOARD_URL overrides). */
  examplesUrl?: string;
  /** Spawn `PORT=<port> bun run dashboard` when Examples health is down (default true). */
  autoStartExamples?: boolean;
}

export const DEFAULT_DASHBOARD_STALE_MS = 15_000;
export const DEFAULT_DASHBOARD_SSE_POLL_MS = 5_000;
export const DEFAULT_DASHBOARD_POLL_HINT_MS = 5_000;

export function parseOrchestratorDashboardSection(
  section: Record<string, unknown> | undefined
): HerdrOrchestratorDashboardConfig {
  const staleRaw =
    typeof section?.staleMs === "number"
      ? section.staleMs
      : typeof section?.stale_ms === "number"
        ? section.stale_ms
        : DEFAULT_DASHBOARD_STALE_MS;
  const pollRaw =
    typeof section?.pollHintMs === "number"
      ? section.pollHintMs
      : typeof section?.poll_hint_ms === "number"
        ? section.poll_hint_ms
        : DEFAULT_DASHBOARD_POLL_HINT_MS;
  const sseRaw =
    typeof section?.ssePollMs === "number"
      ? section.ssePollMs
      : typeof section?.sse_poll_ms === "number"
        ? section.sse_poll_ms
        : pollRaw;
  const webview = section?.webview === true || section?.webview === "true";
  const persistProfile =
    section?.persistProfile === true ||
    section?.persist_profile === true ||
    section?.persistProfile === "true" ||
    section?.persist_profile === "true";
  const profileDir =
    typeof section?.profileDir === "string"
      ? section.profileDir.trim()
      : typeof section?.profile_dir === "string"
        ? section.profile_dir.trim()
        : undefined;
  const examplesUrl =
    typeof section?.examplesUrl === "string"
      ? section.examplesUrl.trim()
      : typeof section?.examples_url === "string"
        ? section.examples_url.trim()
        : undefined;
  const autoStartExamples =
    section?.autoStartExamples === false ||
    section?.auto_start_examples === false ||
    section?.autoStartExamples === "false" ||
    section?.auto_start_examples === "false"
      ? false
      : section?.autoStartExamples === true ||
          section?.auto_start_examples === true ||
          section?.autoStartExamples === "true" ||
          section?.auto_start_examples === "true"
        ? true
        : undefined;
  return {
    staleMs: staleRaw > 0 ? staleRaw : DEFAULT_DASHBOARD_STALE_MS,
    ssePollMs: sseRaw > 0 ? sseRaw : DEFAULT_DASHBOARD_SSE_POLL_MS,
    pollHintMs: pollRaw > 0 ? pollRaw : DEFAULT_DASHBOARD_POLL_HINT_MS,
    ...(webview ? { webview: true } : {}),
    ...(persistProfile ? { persistProfile: true } : {}),
    ...(profileDir ? { profileDir } : {}),
    ...(examplesUrl ? { examplesUrl } : {}),
    ...(autoStartExamples !== undefined ? { autoStartExamples } : {}),
  };
}

export interface HerdrOrchestratorConfig {
  enabled: boolean;
  /** Sync agentsTab context when an agent transitions working → idle. */
  contextOnIdle: boolean;
  /** Agent label to read for handoff summary (default: primary). */
  handoffFrom: string | null;
  /** Agent pane to receive handoff via agent send (default: first secondary). */
  handoffTo: string | null;
  /** Tab label for finish-work reviewer escalation. */
  reviewerTab: string;
  /** Tab label for finish-work doctor-pane gate routing. */
  doctorTab: string;
  events: HerdrOrchestratorEventsConfig;
  /** Cross-workspace handoff rules. */
  handoffRules: HandoffRule[];
  /** Remote host labels → SSH connection strings or per-host configs. Empty = remote discovery disabled. */
  remoteHosts: Record<string, string | RemoteHostConfig>;
  /** Global SSH defaults applied to all remote hosts. */
  remoteDefaults: RemoteDefaults;
  /** Webhook notification settings. */
  notifications: NotificationsConfig;
  /** Domain groups for hosts. */
  domains: Record<string, DomainConfig>;
  /** Dashboard SSE / stale detection tuning. */
  dashboard: HerdrOrchestratorDashboardConfig;
}

export interface NotificationsConfig {
  /** When false, all notification fields are suppressed regardless of project overrides. */
  enabled?: boolean;
  webhookUrl?: string;
  onHandoff?: boolean;
  onSpawn?: boolean;
  onError?: boolean;
}

// ── Domains ─────────────────────────────────────────────────────────────

/** A domain groups remote hosts with shared defaults, rules, and notification settings. */
export interface DomainConfig {
  /** Host labels in this domain. */
  hosts: string[];
  /** Domain-specific SSH defaults (merged on top of global remote_defaults). */
  defaults?: RemoteDefaults;
  /** Domain-specific notification settings. */
  notifications?: NotificationsConfig;
  /** Domain-specific handoff rules (evaluated in addition to global rules). */
  handoffRules?: HandoffRule[];
}

/** Resolve which domains a host belongs to. */
export function hostDomains(hostLabel: string, domains?: Record<string, DomainConfig>): string[] {
  if (!domains) return [];
  return Object.entries(domains)
    .filter(([, d]) => d.hosts.includes(hostLabel))
    .map(([name]) => name);
}

/** Get merged defaults for a host, with domain defaults layered on global. */
export function hostMergedDefaults(
  hostLabel: string,
  globalDefaults?: RemoteDefaults,
  domains?: Record<string, DomainConfig>
): RemoteDefaults {
  const merged: RemoteDefaults = { ...globalDefaults };
  for (const [, domain] of Object.entries(domains || {})) {
    if (domain.hosts.includes(hostLabel) && domain.defaults) {
      Object.assign(merged, domain.defaults);
    }
  }
  return merged;
}

// ── TOML parsing ────────────────────────────────────────────────────────

export function parseHerdrOrchestratorSection(
  section: Record<string, unknown> | undefined
): HerdrOrchestratorConfig | null {
  if (!section || typeof section !== "object") return null;
  const nested =
    section.orchestrator && typeof section.orchestrator === "object"
      ? (section.orchestrator as Record<string, unknown>)
      : null;
  if (!nested) return null;

  const eventsNested =
    nested.events && typeof nested.events === "object"
      ? (nested.events as Record<string, unknown>)
      : null;

  // Handoff rules
  const rules: HandoffRule[] = [];
  const rawRules = nested.handoff_rules;
  if (Array.isArray(rawRules)) {
    for (const entry of rawRules) {
      const rule = parseHandoffRuleEntry(entry);
      if (rule) rules.push(rule);
    }
  }

  // Remote hosts — simple strings or per-host config tables
  const remoteHosts: Record<string, string | RemoteHostConfig> = {};
  const rawHosts = nested.remote_hosts;
  if (rawHosts && typeof rawHosts === "object") {
    for (const [key, value] of Object.entries(rawHosts as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        remoteHosts[key] = value;
      } else if (value && typeof value === "object") {
        const tbl = value as Record<string, unknown>;
        const host = typeof tbl.host === "string" ? tbl.host : "";
        if (!host) continue;
        const entry: RemoteHostConfig = { host };
        if (typeof tbl.port === "number") entry.port = tbl.port;
        if (typeof tbl.user === "string") entry.user = tbl.user;
        if (typeof tbl.identity_file === "string") entry.identityFile = tbl.identity_file;
        if (typeof tbl.timeout === "number") entry.timeout = tbl.timeout;
        if (typeof tbl.identities_only === "boolean") entry.identitiesOnly = tbl.identities_only;
        if (typeof tbl.strict_host_key_checking === "string") {
          const v = tbl.strict_host_key_checking;
          if (v === "yes" || v === "no" || v === "accept-new") entry.strictHostKeyChecking = v;
        }
        if (typeof tbl.user_known_hosts_file === "string")
          entry.userKnownHostsFile = tbl.user_known_hosts_file;
        if (typeof tbl.server_alive_interval === "number")
          entry.serverAliveInterval = tbl.server_alive_interval;
        if (typeof tbl.server_alive_count_max === "number")
          entry.serverAliveCountMax = tbl.server_alive_count_max;
        if (typeof tbl.control_master === "string") {
          const v = tbl.control_master;
          if (v === "yes" || v === "auto" || v === "no") entry.controlMaster = v;
        }
        if (typeof tbl.control_path === "string") entry.controlPath = tbl.control_path;
        if (typeof tbl.control_persist === "number") entry.controlPersist = tbl.control_persist;
        if (typeof tbl.compression === "boolean") entry.compression = tbl.compression;
        if (typeof tbl.proxy_jump === "string") entry.proxyJump = tbl.proxy_jump;
        remoteHosts[key] = entry;
      }
    }
  }

  // Global remote defaults
  const remoteDefaults: RemoteDefaults = {};
  const rawDefaults = nested.remote_defaults;
  if (rawDefaults && typeof rawDefaults === "object") {
    const d = rawDefaults as Record<string, unknown>;
    if (typeof d.timeout === "number") remoteDefaults.timeout = d.timeout;
    if (typeof d.batch_mode === "boolean") remoteDefaults.batchMode = d.batch_mode;
    if (typeof d.connect_timeout === "number") remoteDefaults.connectTimeout = d.connect_timeout;
    if (typeof d.identity_file === "string") remoteDefaults.identityFile = d.identity_file;
    if (typeof d.identities_only === "boolean") remoteDefaults.identitiesOnly = d.identities_only;
    if (typeof d.strict_host_key_checking === "string") {
      const v = d.strict_host_key_checking;
      if (v === "yes" || v === "no" || v === "accept-new") remoteDefaults.strictHostKeyChecking = v;
    }
    if (typeof d.user_known_hosts_file === "string")
      remoteDefaults.userKnownHostsFile = d.user_known_hosts_file;
    if (typeof d.server_alive_interval === "number")
      remoteDefaults.serverAliveInterval = d.server_alive_interval;
    if (typeof d.server_alive_count_max === "number")
      remoteDefaults.serverAliveCountMax = d.server_alive_count_max;
    if (typeof d.control_master === "string") {
      const v = d.control_master;
      if (v === "yes" || v === "auto" || v === "no") remoteDefaults.controlMaster = v;
    }
    if (typeof d.control_path === "string") remoteDefaults.controlPath = d.control_path;
    if (typeof d.control_persist === "number") remoteDefaults.controlPersist = d.control_persist;
    if (typeof d.compression === "boolean") remoteDefaults.compression = d.compression;
    if (typeof d.proxy_jump === "string") remoteDefaults.proxyJump = d.proxy_jump;
  }

  // Domains
  const domains: Record<string, DomainConfig> = {};
  const rawDomains = nested.domains;
  if (rawDomains && typeof rawDomains === "object") {
    for (const [domainName, domainValue] of Object.entries(rawDomains as Record<string, unknown>)) {
      if (!domainValue || typeof domainValue !== "object") continue;
      const d = domainValue as Record<string, unknown>;
      const hosts: string[] = [];
      if (Array.isArray(d.hosts)) {
        for (const h of d.hosts) if (typeof h === "string") hosts.push(h);
      }
      if (hosts.length === 0) continue;
      const domain: DomainConfig = { hosts };
      // Domain defaults (inline — same shape as remote_defaults parsing)
      if (d.defaults && typeof d.defaults === "object") {
        const dd = d.defaults as Record<string, unknown>;
        const domainDefs: RemoteDefaults = {};
        if (typeof dd.timeout === "number") domainDefs.timeout = dd.timeout;
        if (typeof dd.batch_mode === "boolean") domainDefs.batchMode = dd.batch_mode;
        if (typeof dd.connect_timeout === "number") domainDefs.connectTimeout = dd.connect_timeout;
        if (typeof dd.identity_file === "string") domainDefs.identityFile = dd.identity_file;
        domain.defaults = domainDefs;
      }
      // Domain notifications
      if (d.notifications && typeof d.notifications === "object") {
        const n = d.notifications as Record<string, unknown>;
        domain.notifications = {};
        if (typeof n.webhook_url === "string") domain.notifications.webhookUrl = n.webhook_url;
        if (typeof n.on_handoff === "boolean") domain.notifications.onHandoff = n.on_handoff;
        if (typeof n.on_spawn === "boolean") domain.notifications.onSpawn = n.on_spawn;
        if (typeof n.on_error === "boolean") domain.notifications.onError = n.on_error;
      }
      // Domain handoff rules (inline — same shape as global handoff_rules parsing)
      if (Array.isArray(d.handoff_rules)) {
        const domainRules: HandoffRule[] = [];
        for (const entry of d.handoff_rules) {
          const rule = parseHandoffRuleEntry(entry);
          if (rule) domainRules.push(rule);
        }
        if (domainRules.length > 0) domain.handoffRules = domainRules;
      }
      domains[domainName] = domain;
    }
  }

  const dashboardNested =
    nested.dashboard && typeof nested.dashboard === "object"
      ? (nested.dashboard as Record<string, unknown>)
      : undefined;

  // Notifications config
  const notifications: NotificationsConfig = {};
  const rawNotifications = nested.notifications;
  if (rawNotifications && typeof rawNotifications === "object") {
    const n = rawNotifications as Record<string, unknown>;
    if (typeof n.webhook_url === "string") notifications.webhookUrl = n.webhook_url;
    if (typeof n.on_handoff === "boolean") notifications.onHandoff = n.on_handoff;
    if (typeof n.on_spawn === "boolean") notifications.onSpawn = n.on_spawn;
    if (typeof n.on_error === "boolean") notifications.onError = n.on_error;
  }

  return {
    enabled: nested.enabled !== false,
    contextOnIdle: nested.contextOnIdle !== false,
    handoffFrom: typeof nested.handoffFrom === "string" ? nested.handoffFrom : null,
    handoffTo: typeof nested.handoffTo === "string" ? nested.handoffTo : null,
    reviewerTab: typeof nested.reviewerTab === "string" ? nested.reviewerTab : "reviewer",
    doctorTab: typeof nested.doctorTab === "string" ? nested.doctorTab : "doctor",
    events: parseOrchestratorEventsSection(eventsNested),
    handoffRules: rules,
    remoteHosts,
    remoteDefaults,
    notifications,
    domains,
    dashboard: parseOrchestratorDashboardSection(dashboardNested),
  };
}

export function parseOrchestratorEventsSection(
  section: Record<string, unknown> | null
): HerdrOrchestratorEventsConfig {
  if (!section) {
    return {
      enabled: true,
      debounceMs: 2_000,
      allowlist: [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST],
      watchGit: true,
      gitRefCooldownMs: DEFAULT_GIT_REF_COOLDOWN_MS,
    };
  }

  let allowlist: string[] | null = [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST];
  if (Array.isArray(section.allowlist)) {
    const parsed = section.allowlist.filter((row): row is string => typeof row === "string");
    allowlist = parsed.length ? parsed : null;
  } else if (section.allowlist === null) {
    allowlist = null;
  }

  return {
    enabled: section.enabled !== false,
    debounceMs: (() => {
      const camel = section.debounceMs;
      const snake = section.debounce_ms;
      const value = typeof camel === "number" ? camel : typeof snake === "number" ? snake : 2_000;
      return value >= 0 ? value : 2_000;
    })(),
    allowlist,
    watchGit: section.watchGit !== false,
    gitRefCooldownMs: parseGitRefCooldownMs(section),
  };
}

export function resolveOrchestratorConfig(
  config: HerdrProjectConfig,
  doc?: Record<string, unknown> | null
): HerdrOrchestratorConfig {
  const fromDoc =
    doc?.herdr && typeof doc.herdr === "object"
      ? parseHerdrOrchestratorSection(doc.herdr as Record<string, unknown>)
      : null;

  const handoffFrom =
    fromDoc?.handoffFrom ??
    config.primaryAgent ??
    config.agentsTab?.panes.find((p) => p.role === "primary")?.agent ??
    null;
  const handoffTo =
    fromDoc?.handoffTo ??
    config.secondaryAgents[0] ??
    config.agentsTab?.panes.find((p) => p.role === "secondary")?.agent ??
    null;

  return {
    enabled: fromDoc?.enabled ?? true,
    contextOnIdle: fromDoc?.contextOnIdle ?? true,
    handoffFrom,
    handoffTo,
    reviewerTab: fromDoc?.reviewerTab ?? "reviewer",
    doctorTab: fromDoc?.doctorTab ?? "doctor",
    events: fromDoc?.events ?? parseOrchestratorEventsSection(null),
    handoffRules: fromDoc?.handoffRules ?? [],
    remoteHosts: fromDoc?.remoteHosts ?? {},
    remoteDefaults:
      fromDoc?.remoteDefaults ??
      (() => {
        // Auto-pull from Herdr's own ~/.config/herdr/config.toml [remote] section
        // when no [herdr.orchestrator.remote_defaults] is explicitly set
        const herdrDefaults = readHerdrRemoteDefaults();
        return Object.keys(herdrDefaults).length > 0 ? herdrDefaults : {};
      })(),
    notifications: mergeNotifications(fromDoc?.notifications ?? {}, readHerdrNotifyDefaults()),
    domains: fromDoc?.domains ?? {},
    dashboard: fromDoc?.dashboard ?? parseOrchestratorDashboardSection(undefined),
  };
}
