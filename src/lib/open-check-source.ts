/**
 * Parse file:line:col from check messages and open via Bun.openInEditor.
 */

import { resolve } from "path";
import { openFileInEditor } from "./bun-utils.ts";

export interface CheckSource {
  file: string;
  line?: number;
  column?: number;
}

const SOURCE_RE = /(?:^|\s|at\s)([^\s:()]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/;

/** Extract a navigable source location from a check message. */
export function parseCheckSource(message: string): CheckSource | undefined {
  const match = message.match(SOURCE_RE);
  if (!match?.[1]) return undefined;
  return {
    file: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
  };
}

export interface OpenableCheck {
  status: string;
  message: string;
  source?: CheckSource;
}

/** Open the first warn/error check in the user's editor. Returns true when opened. */
export function openFirstFailedCheck(checks: OpenableCheck[], cwd = process.cwd()): boolean {
  const failed = checks.find((c) => c.status === "error" || c.status === "warn");
  if (!failed) return false;
  const source = failed.source ?? parseCheckSource(failed.message);
  if (!source) return false;
  const file = source.file.startsWith("/") ? source.file : resolve(cwd, source.file);
  openFileInEditor(file, { line: source.line, column: source.column });
  return true;
}

/** Open first hardcoded-secrets gate finding when present. */
export function openFirstGateFinding(
  gate: string,
  detail: { findings?: Array<{ file: string; line: number }> } | undefined,
  cwd = process.cwd()
): boolean {
  if (gate !== "hardcoded-secrets") return false;
  const first = detail?.findings?.[0];
  if (!first) return false;
  const file = first.file.startsWith("/") ? first.file : resolve(cwd, first.file);
  openFileInEditor(file, { line: first.line });
  return true;
}
