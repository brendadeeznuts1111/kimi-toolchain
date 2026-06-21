// templates/modules/terminal/src/processor.ts
// Bun Terminal effect — registered via registerEffect("terminal") in init.ts

/** Detect whether stdin is a TTY. */
export function isTTY(): boolean {
  return Bun.stdin.isTTY();
}

/** Return terminal size if available. */
export function size(): { columns: number; rows: number } | null {
  if (!Bun.stdin.isTTY()) return null;
  const writer = Bun.stdout.writer();
  try {
    const columns = (writer as unknown as { columns?: number }).columns ?? 80;
    const rows = (writer as unknown as { rows?: number }).rows ?? 24;
    return { columns, rows };
  } catch {
    return { columns: 80, rows: 24 };
  }
}

/** Write styled text using ANSI codes if stdout is a TTY. */
export function style(text: string, codes: string[]): string {
  if (!Bun.stdout.isTTY()) return text;
  const open = codes.join(";");
  return `\u001b[${open}m${text}\u001b[0m`;
}
