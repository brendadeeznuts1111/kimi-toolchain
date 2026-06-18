import { execArgvSync } from "./bun-utils.ts";

import { desktopBinDir, homeDir, localBinDir } from "./paths.ts";

/**
 * Herdr 0.7+: only some subcommands accept `--json`.
 * workspace/pane/agent list reject the flag but still emit JSON on stdout.
 */
export const HERDR_SUBCOMMANDS_ACCEPT_JSON = new Set([
  "session list",
  "plugin list",
  "server agent-manifests",
]);

/** First two positional tokens — strips flags (pane list --workspace wB → "pane list"). */
export function herdrSubcommandKey(args: string[]): string {
  return args
    .filter((arg) => !arg.startsWith("-"))
    .slice(0, 2)
    .join(" ");
}

/** Append `--json` only for subcommands that require it; others emit JSON natively. */
export function ensureJsonArgs(args: string[]): string[] {
  if (args.includes("--json")) return args;
  if (HERDR_SUBCOMMANDS_ACCEPT_JSON.has(herdrSubcommandKey(args))) {
    return [...args, "--json"];
  }
  return args;
}

/** Remote SSH argv: `herdr` + optional `--session` + subcommand with correct `--json` policy. */
export function buildRemoteHerdrArgs(
  session: string | undefined,
  subcommandArgs: string[]
): string[] {
  const jsonArgs = ensureJsonArgs(subcommandArgs);
  return session ? ["herdr", "--session", session, ...jsonArgs] : ["herdr", ...jsonArgs];
}

export type ExecCliOptions = {
  timeout?: number;
  session?: string;
};

/**
 * Resolved session name for automation, or "" for the primary server.
 * Empty, "default", and unset all mean ~/.config/herdr/herdr.sock.
 *
 * Herdr 0.7.0: HERDR_SESSION env does not select the socket — only `herdr --session NAME`
 * or HERDR_SOCKET_PATH do. Toolchain automation therefore uses the primary server unless
 * a future Herdr release restores env-based routing.
 */
export function resolveHerdrSession(explicit?: string): string {
  const session = (explicit !== undefined ? explicit : (Bun.env.HERDR_SESSION ?? "")).trim();
  if (!session || session === "default") return "";
  return session;
}

/** Child-process env for herdr CLI. Primary server: HERDR_SESSION unset. */
export function herdrSessionEnv(explicit?: string): NodeJS.ProcessEnv {
  const resolved = resolveHerdrSession(explicit);
  const env = { ...Bun.env };
  if (!resolved) {
    delete env.HERDR_SESSION;
    delete env.HERDR_SOCKET_PATH;
    return env;
  }
  env.HERDR_SESSION = resolved;
  return env;
}

/** Session routing: pass `--session` CLI arg for Herdr 0.7.0+ (HERDR_SESSION env is ignored). */
export function herdrSessionArgs(session?: string): string[] {
  const resolved = resolveHerdrSession(session);
  return resolved ? ["--session", resolved] : [];
}

export function execCli(cmd: string, args: string[] = [], options: ExecCliOptions | number = {}) {
  const opts: ExecCliOptions = typeof options === "number" ? { timeout: options } : options;
  const timeout = opts.timeout ?? 30_000;
  const resolved = resolveHerdrSession(opts.session);
  const sessionArgs = resolved ? ["--session", resolved] : [];
  try {
    return {
      ok: true,
      output: execArgvSync(cmd, [...sessionArgs, ...args], {
        timeout,
        env: herdrSessionEnv(opts.session),
      }),
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      ok: false,
      output: `${err.stdout || ""}${err.stderr || ""}`.trim(),
      code: err.status ?? 1,
    };
  }
}

export function execCliJson(cmd: string, args: string[] = [], session?: string) {
  const result = execCli(cmd, ensureJsonArgs(args), { session });
  if (!result.ok) return { ok: false as const, error: result.output, json: null };
  try {
    return { ok: true as const, json: JSON.parse(result.output), error: null };
  } catch {
    return { ok: false as const, error: "invalid JSON from herdr CLI", json: null };
  }
}

export function herdrCliRun(session?: string, args: string[] = [], timeout = 30_000) {
  return execCli("herdr", args, { timeout, session });
}

export function herdrCliJson(session?: string, args: string[] = []) {
  const result = herdrCliRun(session, ensureJsonArgs(args));
  if (!result.ok) return { ok: false as const, error: result.output, json: null };
  try {
    return { ok: true as const, json: JSON.parse(result.output), error: null };
  } catch {
    return { ok: false as const, error: "invalid JSON from herdr CLI", json: null };
  }
}

export function resolveHerdrPanePath(home = homeDir()): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    for (const entry of String(value || "").split(":")) {
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      parts.push(entry);
    }
  };
  add(Bun.env.PATH);
  for (const segment of [
    localBinDir(home),
    desktopBinDir(home),
    `${home}/.bun/bin`,
    `${home}/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    add(segment);
  }
  return parts.join(":");
}
