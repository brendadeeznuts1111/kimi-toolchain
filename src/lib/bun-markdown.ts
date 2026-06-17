/**
 * bun-markdown.ts — Bun.markdown.ansi helpers (v1.3.12+).
 *
 * @see https://bun.sh/docs/runtime/markdown
 * @see https://bun.com/blog/bun-v1.3.12#render-markdown-in-the-terminal-with-bun-file-md
 */

export interface MarkdownAnsiOptions {
  colors?: boolean;
  columns?: number;
  /** Clickable OSC-8 hyperlinks when terminal supports them. */
  hyperlinks?: boolean;
  kittyGraphics?: boolean;
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

  const theme: MarkdownAnsiOptions = {};
  if (options.colors !== undefined) theme.colors = options.colors;
  if (options.columns !== undefined) theme.columns = options.columns;
  if (options.hyperlinks !== undefined) theme.hyperlinks = options.hyperlinks;
  if (options.kittyGraphics !== undefined) theme.kittyGraphics = options.kittyGraphics;

  return Bun.markdown.ansi(text, Object.keys(theme).length > 0 ? theme : undefined);
}
