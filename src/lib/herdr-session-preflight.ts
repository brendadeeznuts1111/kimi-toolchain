import { execCliJson } from "./herdr-project-cli.ts";

type HerdrSessionRow = {
  name: string;
  running: boolean;
  default?: boolean;
  session_dir?: string;
  socket_path?: string;
};

type HerdrSessionList = { sessions: HerdrSessionRow[] };

export class HerdrSessionError extends Error {
  constructor(
    public readonly session: string,
    public readonly reason: "missing" | "stopped",
    public readonly hint: string
  ) {
    super(`herdr session "${session}" ${reason} — ${hint}`);
  }
}

function resolveSessionTarget(sessionName?: string): string {
  const trimmed = sessionName?.trim();
  if (!trimmed || trimmed === "default") return "default";
  return trimmed;
}

export type ListHerdrSessions = () =>
  | { ok: true; sessions: HerdrSessionRow[] }
  | { ok: false; error: string };

export function defaultListHerdrSessions(): ReturnType<ListHerdrSessions> {
  const result = execCliJson("herdr", ["session", "list", "--json"]);
  if (!result.ok) {
    return { ok: false, error: result.error || "herdr CLI returned non-zero — check installation" };
  }
  const parsed = result.json as HerdrSessionList;
  return { ok: true, sessions: parsed.sessions ?? [] };
}

export async function requireSessionRunning(
  sessionName?: string,
  listSessions: ListHerdrSessions = defaultListHerdrSessions
): Promise<void> {
  const target = resolveSessionTarget(sessionName);
  const result = listSessions();

  if (!result.ok) {
    throw new HerdrSessionError(
      target,
      "stopped",
      result.error || "herdr CLI returned non-zero — check installation"
    );
  }

  const row = result.sessions.find((s) => s.name === target);

  if (!row) {
    throw new HerdrSessionError(target, "missing", `create with: herdr --session ${target} server`);
  }

  if (!row.running) {
    throw new HerdrSessionError(target, "stopped", `start with: herdr --session ${target} server`);
  }
}
