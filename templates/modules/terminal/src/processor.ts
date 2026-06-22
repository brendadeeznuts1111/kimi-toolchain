// templates/modules/terminal/src/processor.ts
// Bun Terminal effect — registered via registerEffect("terminal") in init.ts

function fdIsTTY(fd: 0 | 1): boolean {
  return Bun.spawnSync({ cmd: ["test", "-t", String(fd)] }).exitCode === 0;
}

/** Detect whether stdin is a TTY. */
export function isTTY(): boolean {
  return fdIsTTY(0);
}

/** Return terminal size if available. */
export function size(): { columns: number; rows: number } | null {
  if (!isTTY()) return null;
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", "stty size 2>/dev/null || echo 24 80"],
    stdout: "pipe",
  });
  const out = proc.stdout?.toString().trim() ?? "24 80";
  const [rowsRaw, colsRaw] = out.split(/\s+/);
  const rows = Number(rowsRaw) || 24;
  const columns = Number(colsRaw) || 80;
  return { columns, rows };
}

/** Write styled text using ANSI codes if stdout is a TTY. */
export function style(text: string, codes: string[]): string {
  if (!fdIsTTY(1)) return text;
  const open = codes.join(";");
  return `\u001b[${open}m${text}\u001b[0m`;
}