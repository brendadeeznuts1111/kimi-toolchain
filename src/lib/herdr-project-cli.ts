import { execFileSync } from "node:child_process";
import { homeDir } from "./paths.ts";

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
      output: execFileSync(cmd, [...sessionArgs, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        env: herdrSessionEnv(opts.session),
      }).trim(),
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
  const result = execCli(cmd, args, { session });
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
  const result = herdrCliRun(session, args);
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
    `${home}/.local/bin`,
    `${home}/.kimi-code/bin`,
    `${home}/.bun/bin`,
    `${home}/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    add(segment);
  }
  return parts.join(":");
}
