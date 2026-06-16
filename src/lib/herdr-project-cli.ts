import { execFileSync } from "node:child_process";
import { homeDir } from "./paths.ts";

export type ExecCliOptions = {
  timeout?: number;
  session?: string;
};

/** HERDR_SESSION env, or explicit session; empty and "default" mean the primary server. */
export function resolveHerdrSession(explicit?: string): string {
  const session = (explicit !== undefined ? explicit : (process.env.HERDR_SESSION ?? "")).trim();
  if (!session || session === "default") return "";
  return session;
}

/** Child-process env for herdr CLI — HERDR_SESSION is authoritative (not --session). */
export function herdrSessionEnv(explicit?: string): NodeJS.ProcessEnv {
  const resolved = resolveHerdrSession(explicit);
  const env = { ...process.env };
  if (!resolved) {
    delete env.HERDR_SESSION;
    return env;
  }
  env.HERDR_SESSION = resolved;
  return env;
}

/** @deprecated Prefer HERDR_SESSION via herdrSessionEnv; --session targets a different namespace. */
export function herdrSessionArgs(_session?: string): string[] {
  return [];
}

export function execCli(cmd: string, args: string[] = [], options: ExecCliOptions | number = {}) {
  const opts: ExecCliOptions = typeof options === "number" ? { timeout: options } : options;
  const timeout = opts.timeout ?? 30_000;
  try {
    return {
      ok: true,
      output: execFileSync(cmd, args, {
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
  add(process.env.PATH);
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
