/**
 * bun-markdown.ts — Bun.markdown.ansi helpers (v1.3.14+).
 *
 * @see https://bun.sh/docs/runtime/markdown
 */

export interface MarkdownAnsiOptions {
  colors?: boolean;
  columns?: number;
}

/** True when Bun.markdown.ansi is available in this runtime. */
export function markdownAnsiSupported(): boolean {
  return typeof Bun.markdown?.ansi === "function";
}

/** Strip common markdown syntax for terminals without Bun.markdown.ansi. */
export function stripMarkdownPlain(text: string): string {
  let body = text;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 4);
    if (end > 0) body = body.slice(end + 4).trimStart();
  } else if (body.startsWith("+++")) {
    const end = body.indexOf("\n+++", 4);
    if (end > 0) body = body.slice(end + 4).trimStart();
  }

  return body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
}

/** Render markdown for terminal output; falls back to plain-text stripping. */
export function renderMarkdownAnsi(text: string, options: MarkdownAnsiOptions = {}): string {
  if (!markdownAnsiSupported()) return stripMarkdownPlain(text);

  const theme: { colors?: boolean; columns?: number } = {};
  if (options.colors !== undefined) theme.colors = options.colors;
  if (options.columns !== undefined) theme.columns = options.columns;

  return Bun.markdown.ansi(text, Object.keys(theme).length > 0 ? theme : undefined);
}
