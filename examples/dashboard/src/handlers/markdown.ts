// ── Markdown ──────────────────────────────────────────────────────

export const SAMPLE_MD = `# Dashboard Markdown Demo

## Features

Bun.markdown supports **bold**, *italic*, \`code\`, and [links](https://bun.sh).

### Lists
- Item one
- Item two
  - Nested item
  - Another nested

### Task List
- [x] HTML output
- [x] ANSI terminal
- [x] React elements
- [ ] Custom parser

### Table
| API | Status | Speed |
|-----|--------|-------|
| html() | ✅ | ~1M lines/sec |
| ansi() | ✅ | ~1M lines/sec |
| react() | ✅ | ~1M lines/sec |

### Code Block
\`\`\`typescript
import { serve } from "bun";

serve({
  fetch(req) {
    return new Response("Hello Bun!");
  },
});
\`\`\`

> Blockquote: Bun is a fast all-in-one JavaScript runtime.
`;

export async function apiMarkdownHtml(): Promise<Response> {
  const html = Bun.markdown.html(SAMPLE_MD);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function apiMarkdownAnsi(): Promise<Response> {
  const ansi = Bun.markdown.ansi(SAMPLE_MD, { colors: false });
  return new Response(ansi, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
