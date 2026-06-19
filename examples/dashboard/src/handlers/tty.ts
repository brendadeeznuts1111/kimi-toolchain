// ── TTY ───────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiTty(): Promise<Response> {
  const isTTY = process.stdout?.isTTY ?? false;
  const columns = process.stdout?.columns ?? null;
  const rows = process.stdout?.rows ?? null;
  const term = Bun.env.TERM ?? "unset";
  const colorTerm = Bun.env.COLORTERM ?? "unset";
  const noColor = Bun.env.NO_COLOR ?? "unset";
  const forceColor = Bun.env.FORCE_COLOR ?? "unset";
  const isCI = !!Bun.env.CI;

  // Bun.inspect auto-detect: colors true iff TTY && !CI
  const inspectColors = isTTY && !isCI;

  return jsonResponse({
    isTTY,
    isCI,
    dimensions: { columns, rows },
    terminal: { TERM: term, COLORTERM: colorTerm, NO_COLOR: noColor, FORCE_COLOR: forceColor },
    inspect: {
      colorsAuto: inspectColors,
      note: "Bun.inspect() enables colors if TTY && !CI. Override with --no-color or FORCE_COLOR=1.",
    },
    env: {
      "process.stdout.isTTY": isTTY,
      "process.stdout.columns": columns,
      "process.stdout.rows": rows,
      "Bun.env.TERM": term,
      "Bun.env.CI": Bun.env.CI ?? "unset",
    },
  });
}
