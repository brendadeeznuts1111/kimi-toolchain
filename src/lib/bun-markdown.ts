/**
 * bun-markdown.ts — Bun.markdown facade (v1.3.12+).
 *
 * Probes native Bun.markdown.* APIs with feature detection and graceful
 * fallbacks. Covers .ansi (terminal), .html (HTML string), .render (callback-driven),
 * and .react (React elements).
 *
 * @see https://bun.com/docs/runtime/markdown
 * @see https://bun.com/blog/bun-v1.3.12#render-markdown-in-the-terminal-with-bun-file-md
 */

// ── Types ──────────────────────────────────────────────────────────

export interface MarkdownAnsiOptions {
  colors?: boolean;
  columns?: number;
  /** Clickable OSC-8 hyperlinks when terminal supports them. */
  hyperlinks?: boolean;
  kittyGraphics?: boolean;
}

export interface MarkdownHtmlOptions {
  tables?: boolean;
  strikethrough?: boolean;
  tasklists?: boolean;
  autolinks?: boolean | { url?: boolean; www?: boolean; email?: boolean };
  headings?: boolean | { ids?: boolean };
  hardSoftBreaks?: boolean;
  wikiLinks?: boolean;
  underline?: boolean;
  latexMath?: boolean;
  collapseWhitespace?: boolean;
  permissiveAtxHeaders?: boolean;
  noIndentedCodeBlocks?: boolean;
  noHtmlBlocks?: boolean;
  noHtmlSpans?: boolean;
  tagFilter?: boolean;
}

/** Meta passed to Bun.markdown.render heading callback. */
export interface MarkdownHeadingMeta {
  level: number;
  id?: string;
}

/** Meta passed to Bun.markdown.render code callback. */
export interface MarkdownCodeMeta {
  language?: string;
}

/** Meta passed to Bun.markdown.render list callback. */
export interface MarkdownListMeta {
  ordered: boolean;
  start?: number;
  depth: number;
}

/** Meta passed to Bun.markdown.render listItem callback. */
export interface MarkdownListItemMeta {
  index: number;
  depth: number;
  ordered: boolean;
  start?: number;
  checked?: boolean;
}

/** Meta passed to Bun.markdown.render link callback. */
export interface MarkdownLinkMeta {
  href: string;
  title?: string;
}

/** Meta passed to Bun.markdown.render image callback. */
export interface MarkdownImageMeta {
  src: string;
  title?: string;
}

/** Meta for th/td callbacks. */
export interface MarkdownTableCellMeta {
  align?: "left" | "center" | "right";
}

/**
 * Callbacks for Bun.markdown.render.
 * Each receives `children` (accumulated inner content as string) and optional
 * element-specific `meta`. Return a string to replace, or `null`/`undefined`
 * to omit the element. Unregistered callbacks pass children through unchanged.
 */
export interface MarkdownRenderHandlers {
  // Block
  heading?(children: string, meta: MarkdownHeadingMeta): string | null | undefined;
  paragraph?(children: string): string | null | undefined;
  blockquote?(children: string): string | null | undefined;
  code?(children: string, meta?: MarkdownCodeMeta): string | null | undefined;
  list?(children: string, meta: MarkdownListMeta): string | null | undefined;
  listItem?(children: string, meta: MarkdownListItemMeta): string | null | undefined;
  hr?(): string | null | undefined;
  table?(children: string): string | null | undefined;
  thead?(children: string): string | null | undefined;
  tbody?(children: string): string | null | undefined;
  tr?(children: string): string | null | undefined;
  th?(children: string, meta?: MarkdownTableCellMeta): string | null | undefined;
  td?(children: string, meta?: MarkdownTableCellMeta): string | null | undefined;
  html?(children: string): string | null | undefined;

  // Inline
  strong?(children: string): string | null | undefined;
  emphasis?(children: string): string | null | undefined;
  link?(children: string, meta?: MarkdownLinkMeta): string | null | undefined;
  image?(children: string, meta?: MarkdownImageMeta): string | null | undefined;
  codespan?(children: string): string | null | undefined;
  strikethrough?(children: string): string | null | undefined;
  text?(children: string): string | null | undefined;
}

/** Accumulator for renderMarkdownStructured. */
export interface MarkdownStructuredOutput {
  /** Plain-text version with all formatting stripped. */
  plain: string;
  /** HTML version (null when Bun.markdown.html is unavailable). */
  html: string | null;
  /** Ordered heading outline [{level, text}]. */
  headings: Array<{ level: number; text: string }>;
  /** Ordered codeblock outline [{lang, code}]. */
  codeblocks: Array<{ lang: string; code: string }>;
}

// ── Feature probes ─────────────────────────────────────────────────

/** True when Bun.markdown is available in this runtime. */
export function markdownSupported(): boolean {
  return typeof Bun.markdown === "object" && Bun.markdown !== null;
}

/** True when Bun.markdown.ansi is available. */
export function markdownAnsiSupported(): boolean {
  return typeof Bun.markdown?.ansi === "function";
}

/** True when Bun.markdown.html is available. */
export function markdownHtmlSupported(): boolean {
  return typeof Bun.markdown?.html === "function";
}

/** True when Bun.markdown.render is available. */
export function markdownRenderSupported(): boolean {
  return typeof Bun.markdown?.render === "function";
}

/** True when Bun.markdown.react is available. */
export function markdownReactSupported(): boolean {
  return typeof Bun.markdown?.react === "function";
}

/** Aggregate probe — true when all four Bun.markdown.* APIs are present. */
export function markdownFullSupported(): boolean {
  return (
    markdownAnsiSupported() &&
    markdownHtmlSupported() &&
    markdownRenderSupported() &&
    markdownReactSupported()
  );
}

// ── Plain-text fallback ────────────────────────────────────────────

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

/** Basic markdown → HTML fallback when Bun.markdown.html is unavailable. */
export function markdownToHtmlFallback(text: string): string {
  let body = text;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 4);
    if (end > 0) body = body.slice(end + 4).trimStart();
  }

  const codeBlocks: string[] = [];
  body = body.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code class="language-${lang || "text"}">${escapeHtml(code.trimEnd())}</code></pre>`
    );
    return `\x00CODEBLOCK${idx}\x00`;
  });

  body = body.replace(/`([^`]+)`/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`);
  body = body.replace(/^#{6}\s+(.+)$/gm, "<h6>$1</h6>");
  body = body.replace(/^#{5}\s+(.+)$/gm, "<h5>$1</h5>");
  body = body.replace(/^#{4}\s+(.+)$/gm, "<h4>$1</h4>");
  body = body.replace(/^#{3}\s+(.+)$/gm, "<h3>$1</h3>");
  body = body.replace(/^#{2}\s+(.+)$/gm, "<h2>$1</h2>");
  body = body.replace(/^#{1}\s+(.+)$/gm, "<h1>$1</h1>");
  body = body.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  body = body.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  body = body.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  body = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const paragraphs = body.split(/\n\n+/);
  body = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<h") || trimmed.startsWith("<pre") || trimmed.startsWith("\x00"))
        return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  for (const [idx, codeBlock] of codeBlocks.entries()) {
    body = body.replaceAll(`\x00CODEBLOCK${idx}\x00`, codeBlock);
  }

  return body;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── .ansi() — terminal rendering ───────────────────────────────────

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

// ── .html() — HTML string ──────────────────────────────────────────

/** Render markdown to an HTML string; falls back to basic regex conversion. */
export function renderMarkdownHtml(text: string, options?: MarkdownHtmlOptions): string {
  if (markdownHtmlSupported()) return Bun.markdown.html(text, options);
  return markdownToHtmlFallback(text);
}

// ── .render() — callback-driven rendering ──────────────────────────

/** Render markdown with custom callbacks; no-op fallback when API unavailable. */
export function renderMarkdownCustom(text: string, handlers: MarkdownRenderHandlers): string {
  if (markdownRenderSupported()) {
    return Bun.markdown.render(text, handlers) as string;
  }
  // Fallback: pass-through all text
  return handlers.text?.(text) ?? text;
}

// ── Structured extraction ──────────────────────────────────────────

/**
 * Extract plain text, HTML, heading outline, and codeblock outline
 * from a markdown string. Uses Bun.markdown.render when available
 * for accurate AST traversal; regex fallback otherwise.
 */
export function renderMarkdownStructured(text: string): MarkdownStructuredOutput {
  const headings: Array<{ level: number; text: string }> = [];
  const codeblocks: Array<{ lang: string; code: string }> = [];

  let plain = "";
  let html: string | null = null;

  if (markdownRenderSupported() && markdownHtmlSupported()) {
    // Structured pass: strip all formatting for plain text while collecting
    // heading metadata via the meta parameter.
    plain = Bun.markdown.render(text, {
      heading: (children, meta) => {
        headings.push({ level: meta.level, text: children });
        return children;
      },
      code: (children, meta) => {
        const lang = meta?.language || "text";
        const code = children;
        codeblocks.push({ lang, code });
        return children;
      },
      paragraph: (children) => children,
      strong: (children) => children,
      emphasis: (children) => children,
      link: (children) => children,
      image: () => "",
      codespan: (children) => children,
      strikethrough: (children) => children,
      list: (children) => children,
      listItem: (children) => children,
      blockquote: (children) => children,
      hr: () => "",
      table: (children) => children,
      thead: (children) => children,
      tbody: (children) => children,
      tr: (children) => children,
      th: (children) => children,
      td: (children) => children,
      html: () => "",
    }) as string;
    html = Bun.markdown.html(text);
  } else {
    // Regex fallback
    plain = stripMarkdownPlain(text);

    const headingRe = /^(#{1,6})\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingRe.exec(text)) !== null) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }

    const codeblockRe = /```(\w*)\n([\s\S]*?)```/g;
    while ((match = codeblockRe.exec(text)) !== null) {
      codeblocks.push({ lang: match[1] || "text", code: match[2].trimEnd() });
    }
  }

  return { plain, html, headings, codeblocks };
}

// ── Aggregate namespace ────────────────────────────────────────────

export const markdown = {
  /** True when Bun.markdown is available (any API). */
  get available(): boolean {
    return markdownSupported();
  },
  /** True when all four Bun.markdown.* APIs are present. */
  get full(): boolean {
    return markdownFullSupported();
  },
  ansi: renderMarkdownAnsi,
  html: renderMarkdownHtml,
  render: renderMarkdownCustom,
  /** Render markdown to React elements (requires Bun.markdown.react). */
  react(text: string, options?: Record<string, unknown>): unknown | null {
    if (!markdownReactSupported()) return null;
    return (Bun.markdown as any).react(text, options);
  },
  structured: renderMarkdownStructured,
};
