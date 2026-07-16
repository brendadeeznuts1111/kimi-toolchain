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

/** Parsed GFM table — headers plus body rows. */
export interface MarkdownTableData {
  headers: string[];
  rows: string[][];
}

/** Heading-delimited section with paragraph text and nested tables. */
export interface MarkdownSection {
  title: string;
  level: number;
  content: string;
  tables: MarkdownTableData[];
}

// ── Bounded cache helper ───────────────────────────────────────────

/** Tiny LRU for expensive markdown render results. */
class TinyLru<K, V> {
  private cache = new Map<K, V>();
  constructor(private max: number) {}
  get(key: K): V | undefined {
    const v = this.cache.get(key);
    if (v !== undefined) {
      // Move to back (most recently used).
      this.cache.delete(key);
      this.cache.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.max) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first as K);
    }
  }
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

  const placeholders: string[] = [];
  function stash(html: string): string {
    const idx = placeholders.length;
    placeholders.push(html);
    return `\x00HTML${idx}\x00`;
  }

  body = body.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    stash(
      `<pre><code class="language-${escapeHtml(lang || "text")}">${escapeHtml(code.trimEnd())}</code></pre>`
    )
  );

  body = body.replace(/`([^`]+)`/g, (_, code: string) => stash(`<code>${escapeHtml(code)}</code>`));
  body = body.replace(/^#{6}\s+(.+)$/gm, (_, t: string) => stash(`<h6>${escapeHtml(t)}</h6>`));
  body = body.replace(/^#{5}\s+(.+)$/gm, (_, t: string) => stash(`<h5>${escapeHtml(t)}</h5>`));
  body = body.replace(/^#{4}\s+(.+)$/gm, (_, t: string) => stash(`<h4>${escapeHtml(t)}</h4>`));
  body = body.replace(/^#{3}\s+(.+)$/gm, (_, t: string) => stash(`<h3>${escapeHtml(t)}</h3>`));
  body = body.replace(/^#{2}\s+(.+)$/gm, (_, t: string) => stash(`<h2>${escapeHtml(t)}</h2>`));
  body = body.replace(/^#{1}\s+(.+)$/gm, (_, t: string) => stash(`<h1>${escapeHtml(t)}</h1>`));
  body = body.replace(/\*\*\*([^*]+)\*\*\*/g, (_, t: string) =>
    stash(`<strong><em>${escapeHtml(t)}</em></strong>`)
  );
  body = body.replace(/\*\*([^*]+)\*\*/g, (_, t: string) =>
    stash(`<strong>${escapeHtml(t)}</strong>`)
  );
  body = body.replace(/\*([^*]+)\*/g, (_, t: string) => stash(`<em>${escapeHtml(t)}</em>`));
  body = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) =>
    stash(`<img src="${escapeHtml(sanitizeMarkdownUrl(src))}" alt="${escapeHtml(alt)}">`)
  );
  body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) =>
    stash(`<a href="${escapeHtml(sanitizeMarkdownUrl(href))}">${escapeHtml(label)}</a>`)
  );

  function isPlaceholderToken(token: string): boolean {
    return (
      token.startsWith("\u0000HTML") &&
      token.endsWith("\u0000") &&
      /^HTML\d+$/.test(token.slice(1, -1))
    );
  }

  function splitPlaceholderParagraph(text: string): string[] {
    const parts: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf("\u0000HTML", cursor);
      if (start === -1) {
        parts.push(text.slice(cursor));
        break;
      }
      if (start > cursor) parts.push(text.slice(cursor, start));
      const end = text.indexOf("\u0000", start + 1);
      if (end === -1) {
        parts.push(text.slice(start));
        break;
      }
      parts.push(text.slice(start, end + 1));
      cursor = end + 1;
    }
    return parts;
  }

  const paragraphs = body.split(/\n\n+/);
  body = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      // Only placeholder-only paragraphs bypass escaping; mixed text is escaped below.
      if (isPlaceholderToken(trimmed)) return trimmed;
      if (trimmed.includes("\u0000HTML")) {
        const rendered = splitPlaceholderParagraph(trimmed)
          .map((part) => (isPlaceholderToken(part) ? part : escapeHtml(part)))
          .join("");
        return `<p>${rendered.replace(/\n/g, "<br>")}</p>`;
      }
      return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  for (let idx = placeholders.length - 1; idx >= 0; idx--) {
    const placeholder = placeholders[idx];
    if (placeholder !== undefined) {
      body = body.replaceAll(`\x00HTML${idx}\x00`, placeholder);
    }
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

function sanitizeMarkdownUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return "#";
  return trimmed;
}

// ── .ansi() — terminal rendering ───────────────────────────────────

const ansiCache = new TinyLru<string, string>(64);

/** Render markdown for terminal output; falls back to plain-text stripping. */
export function renderMarkdownAnsi(text: string, options: MarkdownAnsiOptions = {}): string {
  if (!markdownAnsiSupported()) return stripMarkdownPlain(text);

  const key =
    text +
    "\x00" +
    `${options.colors ?? ""}|${options.columns ?? ""}|${options.hyperlinks ?? ""}|${options.kittyGraphics ?? ""}`;
  const cached = ansiCache.get(key);
  if (cached !== undefined) return cached;

  const theme: MarkdownAnsiOptions = {};
  if (options.colors !== undefined) theme.colors = options.colors;
  if (options.columns !== undefined) theme.columns = options.columns;
  if (options.hyperlinks !== undefined) theme.hyperlinks = options.hyperlinks;
  if (options.kittyGraphics !== undefined) theme.kittyGraphics = options.kittyGraphics;

  const out = Bun.markdown.ansi(text, Object.keys(theme).length > 0 ? theme : undefined);
  ansiCache.set(key, out);
  return out;
}

// ── .html() — HTML string ──────────────────────────────────────────

const htmlCache = new TinyLru<string, string>(64);

/** Render markdown to an HTML string; falls back to basic regex conversion. */
export function renderMarkdownHtml(text: string, options?: MarkdownHtmlOptions): string {
  if (!markdownHtmlSupported()) return markdownToHtmlFallback(text);

  const key = text + "\x00" + JSON.stringify(options);
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;

  const out = Bun.markdown.html(text, options);
  htmlCache.set(key, out);
  return out;
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
export function renderMarkdownStructured(
  text: string,
  options: { includeHtml?: boolean } = {}
): MarkdownStructuredOutput {
  const headings: Array<{ level: number; text: string }> = [];
  const codeblocks: Array<{ lang: string; code: string }> = [];

  let plain = "";
  let html: string | null = null;

  const includeHtml = options.includeHtml !== false;

  if (markdownRenderSupported() && (!includeHtml || markdownHtmlSupported())) {
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
    if (includeHtml && markdownHtmlSupported()) {
      html = Bun.markdown.html(text);
    }
  } else {
    // Regex fallback
    plain = stripMarkdownPlain(text);

    const headingRe = /^(#{1,6})\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingRe.exec(text)) !== null) {
      const marks = match[1];
      const headingText = match[2];
      if (!marks || !headingText) continue;
      headings.push({ level: marks.length, text: headingText.trim() });
    }

    const codeblockRe = /```(\w*)\n([\s\S]*?)```/g;
    while ((match = codeblockRe.exec(text)) !== null) {
      codeblocks.push({ lang: match[1] || "text", code: (match[2] ?? "").trimEnd() });
    }
  }

  return { plain, html, headings, codeblocks };
}

// ── Table / section extraction (Bun.markdown.render callbacks) ─────

interface TableExtractState {
  headers: string[];
  rows: string[][];
  cur: string[];
}

function createTableExtractState(): TableExtractState {
  return { headers: [], rows: [], cur: [] };
}

function flushTableRow(state: TableExtractState): void {
  if (state.cur.length === 0) return;
  if (state.headers.length === 0) state.headers = [...state.cur];
  else state.rows.push([...state.cur]);
  state.cur = [];
}

function takeTable(state: TableExtractState): MarkdownTableData | null {
  flushTableRow(state);
  if (state.headers.length === 0) return null;
  const table: MarkdownTableData = {
    headers: [...state.headers],
    rows: state.rows.map((row) => [...row]),
  };
  state.headers = [];
  state.rows = [];
  state.cur = [];
  return table;
}

function passthroughRenderHandlers(): MarkdownRenderHandlers {
  return {
    heading: (children) => children,
    paragraph: (children) => children,
    blockquote: (children) => children,
    code: (children) => children,
    list: (children) => children,
    listItem: (children) => children,
    hr: () => "",
    strong: (children) => children,
    emphasis: (children) => children,
    link: (children) => children,
    image: () => "",
    codespan: (children) => children,
    strikethrough: (children) => children,
    text: (children) => children,
    thead: (children) => children,
    tbody: (children) => children,
    html: () => "",
  };
}

function tableRowHandlers(
  state: TableExtractState
): Pick<MarkdownRenderHandlers, "th" | "td" | "tr"> {
  return {
    th: (children) => {
      state.cur.push(children.trim());
      return "";
    },
    td: (children) => {
      state.cur.push(children.trim());
      return "";
    },
    tr: () => {
      flushTableRow(state);
      return "";
    },
  };
}

/** Extract all GFM tables from markdown via Bun.markdown.render callbacks. */
export function extractMarkdownTables(text: string): MarkdownTableData[] {
  if (!markdownRenderSupported()) return extractMarkdownTablesFallback(text);

  const tables: MarkdownTableData[] = [];
  const state = createTableExtractState();
  Bun.markdown.render(text, {
    ...passthroughRenderHandlers(),
    ...tableRowHandlers(state),
    table: () => {
      const table = takeTable(state);
      if (table) tables.push(table);
      return "";
    },
  });
  const trailing = takeTable(state);
  if (trailing) tables.push(trailing);
  return tables;
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}/.test(line.trim());
}

/** Regex GFM table parser — preserves inline formatting (e.g. `**Core**`). */
export function extractMarkdownTablesFallback(text: string): MarkdownTableData[] {
  const tables: MarkdownTableData[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]?.trim() ?? "";
    if (!headerLine.startsWith("|")) continue;

    const sepLine = lines[i + 1]?.trim() ?? "";
    if (!isMarkdownTableSeparator(sepLine)) continue;

    const headers = parseMarkdownTableRow(headerLine);
    if (headers.length === 0) continue;

    const rows: string[][] = [];
    let rowIndex = i + 2;
    while (rowIndex < lines.length) {
      const rowLine = lines[rowIndex]?.trim() ?? "";
      if (!rowLine.startsWith("|") || isMarkdownTableSeparator(rowLine)) break;
      rows.push(parseMarkdownTableRow(rowLine));
      rowIndex++;
    }

    if (rows.length > 0) tables.push({ headers, rows });
    i = rowIndex - 1;
  }

  return tables;
}

function extractMarkdownSectionsFallback(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...text.matchAll(headingRe)];
  if (matches.length === 0) return sections;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match?.[1] || !match[2] || match.index === undefined) continue;
    const level = match[1].length;
    const title = match[2].trim();
    const start = match.index + match[0].length;
    const nextMatch = i + 1 < matches.length ? matches[i + 1] : undefined;
    const end = nextMatch?.index ?? text.length;
    const body = text.slice(start, end).trim();
    const paragraphs = body
      .split(/\n\n+/)
      .filter((block) => block.trim() && !block.trim().startsWith("|"))
      .map((block) => stripMarkdownPlain(block))
      .join("\n");
    sections.push({
      title,
      level,
      content: paragraphs,
      tables: extractMarkdownTablesFallback(body),
    });
  }
  return sections;
}

/**
 * Parse markdown into heading-delimited sections with paragraph content
 * and GFM tables. Uses Bun.markdown.render when available.
 */
export function extractMarkdownSections(text: string): MarkdownSection[] {
  if (!markdownRenderSupported()) {
    return extractMarkdownSectionsFallback(text);
  }

  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  const contentParts: string[] = [];
  const sectionTables: MarkdownTableData[] = [];
  const tableState = createTableExtractState();

  const flushSection = (): void => {
    if (!current) return;
    current.content = contentParts.join("\n").trim();
    current.tables = sectionTables.map((table) => ({
      headers: [...table.headers],
      rows: table.rows.map((row) => [...row]),
    }));
    sections.push(current);
    contentParts.length = 0;
    sectionTables.length = 0;
    current = null;
  };

  Bun.markdown.render(text, {
    heading: (children, meta) => {
      flushSection();
      current = { title: children.trim(), level: meta.level, content: "", tables: [] };
      return "";
    },
    paragraph: (children) => {
      if (current) contentParts.push(children.trim());
      return "";
    },
    table: () => {
      const table = takeTable(tableState);
      if (table && current) sectionTables.push(table);
      return "";
    },
    th: (children) => {
      tableState.cur.push(children.trim());
      return "";
    },
    td: (children) => {
      tableState.cur.push(children.trim());
      return "";
    },
    tr: () => {
      flushTableRow(tableState);
      return "";
    },
    blockquote: () => "",
    code: () => "",
    list: () => "",
    listItem: () => "",
    hr: () => "",
    strong: (children) => children,
    emphasis: (children) => children,
    link: (children) => children,
    image: () => "",
    codespan: (children) => children,
    strikethrough: (children) => children,
    text: (children) => children,
    thead: () => "",
    tbody: () => "",
    html: () => "",
  });

  const trailing = takeTable(tableState);
  if (trailing && current) sectionTables.push(trailing);
  flushSection();
  return sections;
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
    const markdownReact = Bun.markdown as {
      react: (text: string, options?: Record<string, unknown>) => unknown;
    };
    return markdownReact.react(text, options);
  },
  structured: renderMarkdownStructured,
  extractTables: extractMarkdownTables,
  extractSections: extractMarkdownSections,
};
