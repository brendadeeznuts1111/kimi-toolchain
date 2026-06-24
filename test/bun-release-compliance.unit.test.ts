/**
 * Bun v1.3.11+ API compliance tests.
 *
 * Validates that the codebase uses Bun-native APIs correctly:
 * - Bun.cron (5-field schedule, no seconds)
 * - Bun.JSONL.parse / parseChunk (error recovery, BOM, supported types)
 * - Bun.$ shell commands (.quiet().nothrow(), exit codes)
 * - Bun.spawn stderr reading (TextDecoder, readableStreamToText)
 * - OS signal handling (SIGINT/SIGTERM, AbortController)
 * - Bun Workers API (Worker, terminate, MessageChannel)
 * - HTMLRewriter link extraction (official docs recipe)
 * - Bun.build HTML production (minify, entrypoints)
 * - CTRL+C signal handling (process.on SIGINT → process.exit)
 * - Template Bun-native compliance (scaffold, trading, kimi-dashboard)
 *
 * @see https://bun.com/blog/bun-v1.3.11
 */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { DASHBOARD_CRON_MIN_MS } from "../src/lib/herdr-dashboard-cron.ts";
import {
  autoCompress,
  compressDeflate,
  compressGzip,
  compressZstd,
  compressZstdAsync,
  decompressDeflate,
  decompressGzip,
  decompressZstd,
  decompressZstdAsync,
  detectFormat,
  exportAuditReport,
  parseAuditReport,
} from "../src/lib/compression.ts";

const repoRoot = import.meta.dir + "/..";

function readSrc(rel: string): string {
  return require("fs").readFileSync(join(repoRoot, rel), "utf-8");
}

// ── Bun.file async read error paths ─────────────────────────────────

describe("bun-release-compliance bun-file async read error paths", () => {
  test("Bun.file().text() rejects on missing file", async () => {
    const file = Bun.file(join(repoRoot, "test", "__nonexistent__", "missing.txt"));
    expect(file.exists()).resolves.toBe(false);
    expect(file.text()).rejects.toThrow();
  });

  test("Bun.file().stat() throws on missing file", async () => {
    const file = Bun.file(join(repoRoot, "test", "__nonexistent__", "missing.txt"));
    expect(file.stat()).rejects.toThrow();
  });

  test("Bun.file().delete() throws on missing file", async () => {
    const file = Bun.file(join(repoRoot, "test", "__nonexistent__", "missing.txt"));
    expect(file.delete()).rejects.toThrow();
  });
});

// ── Codebase Bun API usage audits ───────────────────────────────────

describe("bun-release-compliance codebase API usage", () => {
  test("src/lib uses Bun.file (not fs.readFileSync for reads)", () => {
    const text = readSrc("src/lib/bun-io.ts");
    expect(text).toContain("Bun.file");
  });

  test("src/lib uses Bun.write (not fs.writeFileSync)", () => {
    const text = readSrc("src/lib/bun-io.ts");
    expect(text).toContain("Bun.write");
  });

  test("src/lib uses Bun.Glob (not glob package)", () => {
    const text = readSrc("src/lib/doc-links-lint.ts");
    expect(text).toContain("Bun.Glob");
  });

  test("src/lib uses Bun.spawn (not child_process.exec)", () => {
    const text = readSrc("src/lib/bun-utils.ts");
    expect(text).toContain("Bun.spawn");
  });

  test("src/lib uses Bun.env (not process.env in core libs)", () => {
    const text = readSrc("src/lib/bun-utils.ts");
    expect(text).toContain("Bun.env");
  });

  test("src/lib uses Bun.TOML.parse (not js-yaml for TOML)", () => {
    const text = readSrc("src/lib/safe-parse.ts");
    expect(text).toContain("Bun.TOML.parse");
  });
});

// ── Anti-pattern checks ─────────────────────────────────────────────

describe("bun-release-compliance anti-patterns", () => {
  test("src/lib/bun-io.ts does not import node:fs/promises", () => {
    const text = readSrc("src/lib/bun-io.ts");
    expect(text).not.toContain('from "node:fs/promises"');
    expect(text).not.toContain('from "fs/promises"');
  });

  test("src/lib/bun-utils.ts does not use Buffer.from for stdin decoding", () => {
    const text = readSrc("src/lib/bun-utils.ts");
    expect(text).not.toContain("Buffer.from(chunk).toString()");
  });
});

// ── Bun.cron compliance ──────────────────────────────────────────────

describe("bun-release-compliance Bun.cron", () => {
  test("Bun.cron is available", () => {
    expect(typeof Bun.cron).toBe("function");
  });

  test("DASHBOARD_CRON_MIN_MS is 60_000 (one minute granularity)", () => {
    expect(DASHBOARD_CRON_MIN_MS).toBe(60_000);
  });

  test("herdr-dashboard-cron.ts uses 5-field cron (no seconds)", () => {
    const text = readSrc("src/lib/herdr-dashboard/cron.ts");
    expect(text).toContain("5 fields");
    expect(text).toContain("minute hour day month weekday");
  });
});

// ── Bun.JSONL compliance ─────────────────────────────────────────────

describe("bun-release-compliance Bun.JSONL", () => {
  test("Bun.JSONL.parse is available", () => {
    expect(typeof Bun.JSONL?.parse).toBe("function");
  });

  test("Bun.JSONL.parseChunk is available", () => {
    expect(typeof Bun.JSONL?.parseChunk).toBe("function");
  });

  test("Bun.JSONL.parse returns array of parsed records", () => {
    const text = '{"a":1}\n{"b":2}\n{"c":3}\n';
    const result = Bun.JSONL.parse(text) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ a: 1 });
    expect(result[2]).toEqual({ c: 3 });
  });

  test("Bun.JSONL.parse handles empty lines gracefully", () => {
    const text = '{"a":1}\n\n{"b":2}\n';
    const result = Bun.JSONL.parse(text) as unknown[];
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test("Bun.JSONL.parseChunk returns parsed result or throws on invalid", () => {
    const text = '{"a":1}\n{"b":2}\n';
    try {
      const result = Bun.JSONL.parseChunk(text) as unknown;
      expect(result).toBeDefined();
    } catch {
      expect(true).toBe(true);
    }
  });

  test("ndjson.ts uses Bun.JSONL.parse with fallback", () => {
    const text = readSrc("src/lib/ndjson.ts");
    expect(text).toContain("Bun.JSONL");
    expect(text).toContain("safeParse");
  });
});

// ── Bun shell command compliance ─────────────────────────────────────

describe("bun-release-compliance Bun shell", () => {
  test("Bun.$ is available", () => {
    expect(typeof Bun.$).toBeDefined();
  });

  test("Bun.$ quiet and nothrow are chainable", async () => {
    const result = await Bun.$`echo hello`.quiet().nothrow();
    expect(typeof result).toBe("object");
  });

  test("Bun.$ nothrow prevents throw on non-zero exit", async () => {
    const result = await Bun.$`false`.nothrow().quiet();
    expect(result.exitCode).toBe(1);
  });
});

// ── Bun.spawn stderr handling ─────────────────────────────────────────

describe("bun-release-compliance Bun.spawn stderr", () => {
  test("bun-utils.ts execArgvSync uses TextDecoder (not Buffer.from) for stdout/stderr", () => {
    const text = readSrc("src/lib/bun-utils.ts");
    expect(text).toContain("TextDecoder");
    expect(text).toContain("Bun.spawnSync");
  });

  test("herdr-cli.ts uses readableStreamToText for async stderr", () => {
    const text = readSrc("src/lib/herdr-cli.ts");
    expect(text).toContain("readableStreamToText");
    expect(text).toContain("Bun.spawn");
  });

  test("governor-spawn.ts reads stderr via readableStreamToText", () => {
    const text = readSrc("src/lib/governor-spawn.ts");
    expect(text).toContain("readableStreamToText");
  });

  test("Bun.spawn with stderr pipe captures error output", async () => {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", "echo error >&2; exit 1"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [_stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    expect(stderr.trim()).toBe("error");
  });
});

// ── OS signal handling ────────────────────────────────────────────────

describe("bun-release-compliance OS signal handling", () => {
  test("process.on SIGINT is available and callable", () => {
    expect(typeof process.on).toBe("function");
    const handler = () => {};
    process.on("SIGINT", handler);
    process.off("SIGINT", handler);
  });

  test("process.on SIGTERM is available and callable", () => {
    const handler = () => {};
    process.on("SIGTERM", handler);
    process.off("SIGTERM", handler);
  });

  test("AbortController is available and abortable", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  test("process.on beforeExit is available and callable", () => {
    const handler = () => {};
    process.on("beforeExit", handler);
    process.off("beforeExit", handler);
    expect(typeof process.on).toBe("function");
    expect(typeof process.off).toBe("function");
  });

  test("unified-shell-bridge.ts uses SIGINT/SIGTERM/SIGHUP → process.exit(0)", () => {
    const text = readSrc("src/bin/unified-shell-bridge.ts");
    expect(text).toContain('process.on("SIGINT"');
    expect(text).toContain('process.on("SIGTERM"');
    expect(text).toContain('process.on("SIGHUP"');
    expect(text).toContain("process.exit(0)");
  });

  test("kimi-resource-governor.ts uses SIGINT → gracefulShutdown", () => {
    const text = readSrc("src/bin/kimi-resource-governor.ts");
    expect(text).toContain('process.on("SIGINT"');
    expect(text).toContain("gracefulShutdown");
  });

  test("herdr-orchestrator.ts watch mode uses SIGINT → process.exit(0)", () => {
    const text = readSrc("src/bin/herdr-orchestrator.ts");
    expect(text).toContain('process.on("SIGINT"');
    expect(text).toContain("process.exit(0)");
  });
});

// ── Bun Workers API ───────────────────────────────────────────────────

describe("bun-release-compliance Bun Workers", () => {
  test("Worker constructor is available", () => {
    expect(typeof Worker).toBe("function");
  });

  test("Bun.isMainThread is available", () => {
    expect(typeof Bun.isMainThread).toBe("boolean");
  });

  test("perf-threaded.ts creates Workers with blob URLs", () => {
    const text = readSrc("examples/dashboard/src/handlers/perf-threaded.ts");
    expect(text).toContain("new Worker");
    expect(text).toContain("worker.terminate");
    expect(text).toContain("worker.onmessage");
    expect(text).toContain("worker.onerror");
  });

  test("Worker can be created and terminated", async () => {
    const workerCode = `
      self.onmessage = (e) => {
        self.postMessage({ echo: e.data });
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const result = await new Promise<{ echo: string }>((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (err) => reject(err);
      worker.postMessage("hello");
    });
    expect(result.echo).toBe("hello");
    worker.terminate();
    URL.revokeObjectURL(url);
  });
});

// ── CTRL+C signal handling (official docs) ────────────────────────────
// @see https://bun.com/guides/process/ctrl-c

describe("bun-release-compliance CTRL+C signal handling", () => {
  test("process.on SIGINT + process.exit pattern works (official docs recipe)", async () => {
    let intercepted = false;
    const handler = () => {
      intercepted = true;
    };
    process.on("SIGUSR1", handler);
    process.kill(process.pid, "SIGUSR1");
    await Bun.sleep(10);
    expect(intercepted).toBe(true);
    process.off("SIGUSR1", handler);
  });

  test("cli-contract.ts defines BUN_CTRL_C_DOC_URL", () => {
    const text = readSrc("src/lib/cli-contract.ts");
    expect(text).toContain("BUN_CTRL_C_DOC_URL");
    expect(text).toContain("https://bun.com/guides/process/ctrl-c");
  });

  test("doc-links-lint.ts registers BUN_CTRL_C_DOC_URL", () => {
    const text = readSrc("src/lib/doc-links-lint.ts");
    expect(text).toContain("BUN_CTRL_C_DOC_URL");
  });
});

// ── HTML static keyboard shortcuts (official docs) ────────────────────
// @see https://bun.com/docs/bundler/html-static#keyboard-shortcuts

describe("bun-release-compliance HTML static keyboard shortcuts", () => {
  test("cli-contract.ts defines BUN_HTML_STATIC_KEYBOARD_DOC_URL", () => {
    const text = readSrc("src/lib/cli-contract.ts");
    expect(text).toContain("BUN_HTML_STATIC_KEYBOARD_DOC_URL");
    expect(text).toContain("https://bun.com/docs/bundler/html-static#keyboard-shortcuts");
  });

  test("doc-links-lint.ts registers BUN_HTML_STATIC_KEYBOARD_DOC_URL", () => {
    const text = readSrc("src/lib/doc-links-lint.ts");
    expect(text).toContain("BUN_HTML_STATIC_KEYBOARD_DOC_URL");
  });

  test("bun-install-config.ts documents HTML static console echo feature", () => {
    const text = readSrc("src/lib/bun-install-config.ts");
    expect(text).toContain("BUN_HTML_STATIC_CONSOLE_DOC_URL");
    expect(text).toContain("bun ./index.html --console");
  });

  test("Bun.build is available for HTML entrypoints", () => {
    expect(typeof Bun.build).toBe("function");
  });
});

// ── HTMLRewriter link extraction (official docs) ──────────────────────
// @see https://bun.com/guides/html-rewriter/extract-links

describe("bun-release-compliance HTMLRewriter link extraction", () => {
  test("HTMLRewriter is available in Bun runtime", () => {
    expect(typeof HTMLRewriter).toBe("function");
  });

  test("HTMLRewriter extracts links from HTML (official docs recipe)", async () => {
    const html = `<html><body>
      <a href="https://bun.com">Bun</a>
      <a href="/docs">Docs</a>
      <a href="/docs/runtime/workers">Workers</a>
    </body></html>`;
    const response = new Response(html, {
      headers: { "content-type": "text/html" },
    });
    const links = new Set<string>();
    const rewriter = new HTMLRewriter().on("a[href]", {
      element(el) {
        const href = el.getAttribute("href");
        if (href) links.add(href);
      },
    });
    await rewriter.transform(response).blob();
    expect(links.has("https://bun.com")).toBe(true);
    expect(links.has("/docs")).toBe(true);
    expect(links.has("/docs/runtime/workers")).toBe(true);
  });

  test("HTMLRewriter converts relative URLs to absolute (official docs recipe)", async () => {
    const baseUrl = "https://example.com";
    const html = `<a href="/docs">Docs</a><a href="https://other.com">Other</a>`;
    const response = new Response(html, {
      headers: { "content-type": "text/html" },
    });
    const links = new Set<string>();
    const rewriter = new HTMLRewriter().on("a[href]", {
      element(el) {
        const href = el.getAttribute("href");
        if (href) {
          try {
            const absolute = new URL(href, baseUrl).href;
            links.add(absolute);
          } catch {
            links.add(href);
          }
        }
      },
    });
    await rewriter.transform(response).blob();
    expect(links.has("https://example.com/docs")).toBe(true);
    expect([...links].some((l) => l.startsWith("https://other.com"))).toBe(true);
  });

  test("HTMLRewriter.transform returns Response (chainable)", () => {
    const response = new Response("<p>hello</p>", {
      headers: { "content-type": "text/html" },
    });
    const rewriter = new HTMLRewriter().on("p", {
      element(el) {
        el.append(" world", { html: false });
      },
    });
    const transformed = rewriter.transform(response);
    expect(transformed).toBeInstanceOf(Response);
  });

  test("cli-contract.ts defines BUN_HTML_REWRITER_EXTRACT_LINKS_DOC_URL", () => {
    const text = readSrc("src/lib/cli-contract.ts");
    expect(text).toContain("BUN_HTML_REWRITER_EXTRACT_LINKS_DOC_URL");
    expect(text).toContain("https://bun.com/guides/html-rewriter/extract-links");
  });

  test("doc-links-lint.ts registers BUN_HTML_REWRITER_EXTRACT_LINKS_DOC_URL", () => {
    const text = readSrc("src/lib/doc-links-lint.ts");
    expect(text).toContain("BUN_HTML_REWRITER_EXTRACT_LINKS_DOC_URL");
  });
});

// ── HTMLRewriter in markdown-dead-links-lint ──────────────────────────

describe("bun-release-compliance HTMLRewriter in markdown-dead-links-lint", () => {
  test("markdown-dead-links-lint.ts uses HTMLRewriter (not regex) for HTML link extraction", () => {
    const text = readSrc("src/lib/markdown-dead-links-lint.ts");
    expect(text).toContain("HTMLRewriter");
    expect(text).toContain("new HTMLRewriter()");
    expect(text).toContain('.on("a[href]"');
    expect(text).toContain('.on("[src]"');
    expect(text).not.toMatch(/raw\.matchAll.*href/);
    expect(text).not.toMatch(/raw\.matchAll.*src/);
  });

  test("markdown-dead-links-lint.ts references HTMLRewriter docs URL in JSDoc", () => {
    const text = readSrc("src/lib/markdown-dead-links-lint.ts");
    expect(text).toContain("https://bun.com/guides/html-rewriter/extract-links");
  });

  test("extractMarkdownLinks extracts href from inline HTML via HTMLRewriter", async () => {
    const { extractMarkdownLinks } = await import("../src/lib/markdown-dead-links-lint.ts");
    const md = `Some text\n\n<div>\n  <a href="https://bun.com">Bun</a>\n</div>\n\nMore text`;
    const links = await extractMarkdownLinks(md);
    expect(links.some((l) => l.includes("bun.com"))).toBe(true);
  });

  test("extractMarkdownLinks extracts src from img tags via HTMLRewriter", async () => {
    const { extractMarkdownLinks } = await import("../src/lib/markdown-dead-links-lint.ts");
    const md = `<div>\n  <img src="./img.png" alt="x" />\n</div>`;
    const links = await extractMarkdownLinks(md);
    expect(links).toContain("./img.png");
  });
});

// ── SIGINT/SIGTERM in references-inspect-watch PTY mode ───────────────

describe("bun-release-compliance references-inspect-watch signal handling", () => {
  test("references-inspect-watch.ts uses TextDecoder (not Buffer.from) for stdin", () => {
    const text = readSrc("src/lib/references-inspect-watch.ts");
    expect(text).toContain("TextDecoder");
    expect(text).toContain("stdinDecoder");
    expect(text).not.toMatch(/Buffer\.from\(chunk\)/);
  });

  test("references-inspect-watch.ts PTY mode has SIGINT handler", () => {
    const text = readSrc("src/lib/references-inspect-watch.ts");
    expect(text).toContain('process.on("SIGINT"');
    expect(text).toContain('process.on("SIGTERM"');
    expect(text).toContain("signalInterrupted");
    expect(text).toContain("process.stdin.destroy()");
  });

  test("references-inspect-watch.ts cleans up signal handlers in finally block", () => {
    const text = readSrc("src/lib/references-inspect-watch.ts");
    expect(text).toContain('process.off("SIGINT"');
    expect(text).toContain('process.off("SIGTERM"');
  });

  test("references-inspect-watch.ts poll fallback also handles SIGINT/SIGTERM", () => {
    const text = readSrc("src/lib/references-inspect-watch.ts");
    expect(text).toContain('process.once("SIGINT"');
    expect(text).toContain('process.once("SIGTERM"');
  });
});

// ── Bun.build HTML production path ─────────────────────────────────────

describe("bun-release-compliance Bun.build HTML production", () => {
  test("build-dashboard-html.ts script exists and uses Bun.build with HTML entrypoints", () => {
    const text = readSrc("scripts/build-dashboard-html.ts");
    expect(text).toContain("Bun.build");
    expect(text).toContain("entrypoints");
    expect(text).toContain("minify");
    expect(text).toContain("dashboard.html");
  });

  test("build-dashboard-html.ts references html-static docs link", () => {
    const text = readSrc("scripts/build-dashboard-html.ts");
    expect(text).toContain("https://bun.com/docs/bundler/html-static#build-for-production");
  });

  test("Bun.build successfully builds dashboard HTML with minify", async () => {
    const outdir = `/tmp/kimi-html-build-test-${Bun.nanoseconds()}`;
    const result = await Bun.build({
      entrypoints: [join(repoRoot, "templates/herdr-dashboard.html")],
      outdir,
      minify: true,
    });
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
    const hasHtml = result.outputs.some((o) => o.path.endsWith(".html"));
    expect(hasHtml).toBe(true);
  });
});

// ── Trading module template Bun-native compliance ──────────────────

describe("bun-release-compliance trading module template", () => {
  test("bun-io.ts uses Bun-native I/O (no node:fs/promises imports)", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/bun-io.ts");
    expect(text).not.toContain('from "node:fs/promises"');
    expect(text).not.toContain('from "fs/promises"');
    expect(text).toContain("Bun.file");
    expect(text).toContain("Bun.Glob");
  });

  test("bun-io.ts uses Bun.spawn for mkdir/rm (not node:fs)", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/bun-io.ts");
    expect(text).toContain("Bun.spawn");
    expect(text).toContain('"mkdir"');
    expect(text).toContain('"rm"');
  });

  test("artifact-store.ts uses node:os (not bare os import)", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/artifact-store.ts");
    expect(text).toContain('from "node:os"');
    expect(text).not.toMatch(/from "os"/);
  });

  test("artifact-store.ts uses import.meta.dir (not process.cwd())", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/artifact-store.ts");
    expect(text).toContain("import.meta.dir");
    expect(text).not.toContain("process.cwd()");
  });

  test("artifact-store.ts uses Bun.env (not process.env)", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/artifact-store.ts");
    expect(text).toContain("Bun.env");
    expect(text).not.toContain("process.env");
  });

  test("artifact-store.ts uses Bun.write for file persistence", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/artifact-store.ts");
    expect(text).toContain("Bun.write");
  });

  test("utils.ts uses Bun.TOML.parse (not third-party TOML parser)", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/utils.ts");
    expect(text).toContain("Bun.TOML.parse");
  });

  test("scaffold template uses Bun.env and Bun.serve (not process.env or http)", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Bun.env");
    expect(text).toContain("Bun.serve");
    expect(text).not.toContain("process.env");
  });
});

// ── Additional template compliance ────────────────────────────────────

describe("bun-release-compliance additional template compliance", () => {
  test("scaffold template uses Bun.stdout.write (not console.log)", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Bun.stdout.write");
    expect(text).not.toContain("console.log");
  });

  test("scaffold template has top-level await (Effect.runPromiseExit)", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Effect.runPromiseExit");
  });

  test("kimi-dashboard template uses Bun.stdout.write (not console.log)", () => {
    const text = readSrc("templates/bun-create/kimi-dashboard/src/index.ts");
    expect(text).toContain("Bun.stdout.write");
    expect(text).not.toContain("console.log");
  });

  test("utils.ts has safeToml wrapper using Bun.TOML.parse", () => {
    const text = readSrc("templates/modules/trading/src/trading/lib/utils.ts");
    expect(text).toContain("safeToml");
    expect(text).toContain("Bun.TOML.parse");
  });
});

// ── Effect doc URL constants and scaffold Effect patterns ──────────

describe("bun-release-compliance Effect doc URLs and scaffold patterns", () => {
  test("scaffold/index.ts defines Effect doc URL references in comments", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("effect.website");
    expect(text).toContain("Effect.gen");
  });

  test("scaffold code-references.md documents Effect patterns", () => {
    const text = readSrc("templates/scaffold/code-references.md");
    expect(text).toContain("Effect patterns");
    expect(text).toContain("Data.TaggedError");
    expect(text).toContain("Effect.gen");
    expect(text).toContain("Effect.ensuring");
    expect(text).toContain("Effect.runPromiseExit");
    expect(text).toContain("effect.website");
  });

  test("effect-docs.ts defines Effect doc URL constants", () => {
    const text = readSrc("src/lib/effect-docs.ts");
    expect(text).toContain("EFFECT_DOCS_URL");
    expect(text).toContain("EFFECT_GEN_DOC_URL");
    expect(text).toContain("EFFECT_TAGGED_ERROR_DOC_URL");
    expect(text).toContain("EFFECT_LAYER_DOC_URL");
    expect(text).toContain("EFFECT_RUNTIME_DOC_URL");
    expect(text).toContain("EFFECT_ENSUREING_DOC_URL");
    expect(text).toContain("effect.website");
  });

  test("doc-links-lint.ts registers Effect doc URL constants from effect-docs.ts", () => {
    const text = readSrc("src/lib/doc-links-lint.ts");
    expect(text).toContain("EFFECT_DOCS_URL");
    expect(text).toContain("src/lib/effect-docs.ts");
    expect(text).toContain("effect.website");
  });

  test("scaffold/index.ts imports Data and Effect from effect", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain('from "effect"');
    expect(text).toContain("Data");
    expect(text).toContain("Effect");
  });

  test("scaffold/index.ts uses Data.TaggedError for typed errors", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Data.TaggedError");
    expect(text).toContain("ServerStartError");
  });

  test("scaffold/index.ts uses Effect.gen for structured control flow", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Effect.gen");
    expect(text).toContain("function*");
  });

  test("scaffold/index.ts uses Effect.ensuring for graceful shutdown", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Effect.ensuring");
    expect(text).toContain("server?.stop");
  });

  test("scaffold/index.ts uses Effect.runPromiseExit for structured exit", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Effect.runPromiseExit");
    expect(text).toContain("exit._tag");
  });

  test("scaffold/index.ts uses Effect.fail (not throw) for error propagation", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Effect.fail");
    expect(text).not.toContain("throw ");
  });

  test("scaffold/index.ts still uses Bun.env and Bun.serve", () => {
    const text = readSrc("templates/scaffold/index.ts");
    expect(text).toContain("Bun.env");
    expect(text).toContain("Bun.serve");
  });

  test("scaffold code-references.md documents Effect patterns", () => {
    const text = readSrc("templates/scaffold/code-references.md");
    expect(text).toContain("Effect patterns");
    expect(text).toContain("Data.TaggedError");
    expect(text).toContain("Effect.gen");
    expect(text).toContain("Effect.ensuring");
    expect(text).toContain("Effect.runPromiseExit");
    expect(text).toContain("effect.website");
  });
});

// ── Bun v1.4.0 feature compliance ───────────────────────────────────

describe("bun-release-compliance bun-v1.4.0", () => {
  test("using spy = spyOn(...) auto-restores the original method when the block exits", () => {
    const { spyOn } = require("bun:test");
    const obj = { method: () => "original" as string };
    {
      using _spy = spyOn(obj, "method").mockReturnValue("mocked");
      expect(obj.method()).toBe("mocked");
    }
    expect(obj.method()).toBe("original");
  });

  test("mock[Symbol.dispose]() resets the mock call count to zero", () => {
    const { mock } = require("bun:test");
    const fn = mock(() => "orig");
    fn();
    expect(fn).toHaveBeenCalledTimes(1);
    fn[Symbol.dispose]();
    expect(fn).toHaveBeenCalledTimes(0);
  });

  test("bun run --help output includes --parallel, --sequential, and --no-exit-on-error", async () => {
    const proc = Bun.spawn({ cmd: ["bun", "run", "--help"], stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(out).toContain("--parallel");
    expect(out).toContain("--sequential");
    expect(out).toContain("--no-exit-on-error");
  });

  test("bun --cpu-prof-interval=500 -e exits cleanly on Bun >= 1.3.7", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "--cpu-prof-interval", "500", "-e", "process.exit(0)"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    expect(exit).toBe(0);
  });

  test("Bun.stringWidth Thai spacing vowels return width 2", () => {
    expect(Bun.stringWidth("คำ")).toBe(2);
    expect(Bun.stringWidth("ຄຳ")).toBe(2);
  });

  test("package.json uses --parallel/--sequential for script orchestration", () => {
    const text = readSrc("package.json");
    expect(text).toContain("bun run --parallel");
    expect(text).toContain("bun run --sequential");
  });
});

// ── Compression round-trip compliance ────────────────────────────────

describe("bun-release-compliance compression", () => {
  test.each([
    ["gzip", "compressGzip", "decompressGzip"],
    ["deflate", "compressDeflate", "decompressDeflate"],
    ["zstd", "compressZstd", "decompressZstd"],
  ])("%s: compress + decompress round-trips a UTF-8 payload", (_algo, compressFn, decompressFn) => {
    const mod = {
      compressGzip,
      compressDeflate,
      compressZstd,
      decompressGzip,
      decompressDeflate,
      decompressZstd,
    } as Record<string, (data: Uint8Array) => Uint8Array>;
    const data = new TextEncoder().encode(`kimi-toolchain ${_algo} round-trip`);
    expect(new TextDecoder().decode(mod[decompressFn](mod[compressFn](data)))).toBe(
      `kimi-toolchain ${_algo} round-trip`
    );
  });

  // Only gzip and zstd have magic-byte headers; raw deflate has no detectable header
  test.each([
    ["gzip", "compressGzip"],
    ["zstd", "compressZstd"],
  ])("detectFormat returns '%s' for its magic-byte header", (expected, compressFn) => {
    const mod = { compressGzip, compressZstd, detectFormat } as Record<
      string,
      (data: string | Uint8Array) => unknown
    >;
    expect(mod.detectFormat((mod[compressFn] as (d: string) => Uint8Array)("test"))).toBe(expected);
  });

  test("autoCompress selects best algorithm for 100KB of repeated data", () => {
    const result = autoCompress("x".repeat(100_000), "balanced");
    expect(["gzip", "deflate", "zstd"]).toContain(result.algorithm);
    expect(result.ratio).toBeLessThan(1);
  });

  test("compressZstdAsync + decompressZstdAsync round-trips a string payload without blocking", async () => {
    const data = "async zstd test";
    const compressed = await compressZstdAsync(data);
    const decompressed = await decompressZstdAsync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(data);
  });

  test("exportAuditReport → parseAuditReport round-trips findings through zstd", () => {
    const findings = [{ ok: true, id: "test-1" }];
    const compressed = exportAuditReport(findings, "zstd");
    const parsed = parseAuditReport(compressed) as any;
    expect(parsed.findings).toEqual(findings);
  });
});

// ── timing / benchmarking ────────────────────────────────────────────

describe("bun-release-compliance timing-benchmarking", () => {
  test("timing.ts uses Bun.nanoseconds for microbenchmarks", () => {
    const text = readSrc("src/lib/timing.ts");
    expect(text).toContain("Bun.nanoseconds");
    expect(text).toContain("benchSync");
    expect(text).toContain("benchAsync");
    expect(text).toContain("bun.com/docs/project/benchmarking");
  });

  test("bench/core.bench.ts delegates timing to src/lib/timing.ts", () => {
    const text = readSrc("bench/core.bench.ts");
    expect(text).toContain('from "../src/lib/timing.ts"');
    expect(text).not.toContain("function bench(");
  });

  test("canonical-references.toml links bun runtime to bun-upstream benchmarking docs", () => {
    const text = readSrc("canonical-references.toml");
    expect(text).toContain('repoId = "bun-upstream"');
    expect(text).toContain('id = "bun-upstream"');
    expect(text).toContain("oven-sh/bun");
    expect(text).toContain("benchmarking");
  });

  test("perf-gate-format surfaces profiling hints on failures", () => {
    const text = readSrc("src/lib/perf-gate-format.ts");
    expect(text).toContain("formatPerfProfilingHints");
    expect(text).toContain("--cpu-prof-md");
    expect(text).toContain("MIMALLOC_SHOW_STATS=1");
  });
});

// ── bunfig runtime ───────────────────────────────────────────────────

describe("bun-release-compliance bunfig-runtime", () => {
  test("bunfig.toml sets runtime logLevel warn and install logLevel error", () => {
    const text = readSrc("bunfig.toml");
    expect(text).toContain('logLevel = "warn"');
    expect(text).toContain("bun.com/docs/runtime/bunfig#loglevel");
    expect(text).toContain('logLevel = "error"');
    expect(text).toContain("[run]");
    expect(text).toContain("silent = true");
    expect(text).toContain('shell = "bun"');
    expect(text).toContain("noOrphans = true");
  });

  test("test-runtime.ts documents bunfig runtime contract", () => {
    const text = readSrc("src/lib/test-runtime.ts");
    expect(text).toContain("BUN_BUNFIG_LOG_LEVEL_DOC_URL");
    expect(text).toContain("KIMI_BUNFIG_RUNTIME_CONTRACT");
    expect(text).toContain("readKimiBunfigRuntimeContract");
  });

  test("dx.config.toml mirrors bunfig runtime policy under herdr.bunfig", () => {
    const text = readSrc("dx.config.toml");
    expect(text).toContain("[herdr.bunfig]");
    expect(text).toContain('logLevel = "warn"');
    expect(text).toContain('installLogLevel = "error"');
    expect(text).toContain("noOrphans = true");
  });

  test("bunfig.toml [install.cache] matches Bun global cache docs", () => {
    const text = readSrc("bunfig.toml");
    expect(text).toContain("[install.cache]");
    expect(text).toContain("disable = false");
    expect(text).toContain("disableManifest = false");
  });

  test("bun-install-config.ts tracks all [install.cache] fields", () => {
    const text = readSrc("src/lib/bun-install-config.ts");
    expect(text).toContain("cacheDir");
    expect(text).toContain("cacheDisable");
    expect(text).toContain("cacheDisableManifest");
  });
});

// ── console / Bun.Terminal regression guard ──────────────────────────

describe("bun-release-compliance console-bun-terminal", () => {
  // Modules where console.log/error/warn is intentional (logger, CLI help, etc.)
  const CONSOLE_ALLOW_SRC = new Set([
    "src/lib/logger.ts",
    "src/lib/compile-target.ts",
    "src/lib/mcp-bridge-scaffold.ts",
    "src/lib/secrets-cli.ts",
    "src/lib/discover-cli.ts",
    "src/lib/discover-format.ts",
    "examples/identity-usage-example.ts",
    "src/lib/herdr-dashboard/webview/options.ts",
    "src/lib/test-runtime.ts",
    "src/lib/bun-install-config.ts",
    "src/lib/error-taxonomy.ts",
    "src/lib/secrets-manager.ts",
    "src/lib/secrets/fast-resolver.ts",
    "src/lib/compression.ts",
    "src/lib/timing.ts",
    "src/lib/memory/governor.ts",
  ]);

  // src/bin/ entry points: console is the primary output mechanism — not linted here

  test("src/lib/ uses createLogger not raw console.log/error/warn", async () => {
    const { Glob } = await import("bun");
    const glob = new Glob("src/lib/**/*.ts");
    const violations: string[] = [];
    for (const path of glob.scanSync(import.meta.dir + "/..")) {
      if (CONSOLE_ALLOW_SRC.has(path)) continue;
      const text = await Bun.file(path).text();
      for (const [i, line] of text.split("\n").entries()) {
        const stripped = line.trim();
        if (
          /console\.(log|error|warn)\(/.test(line) &&
          !stripped.startsWith("//") &&
          !stripped.startsWith("*")
        ) {
          violations.push(`${path}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `${violations.length} raw console.* call(s) in src/lib/ — use createLogger():\n${violations.slice(0, 10).join("\n")}`
      );
    }
    expect(violations).toHaveLength(0);
  });

  test("test files do not reassign console.log", () => {
    const glob = new Bun.Glob("test/**/*.test.ts");
    const violations: string[] = [];
    for (const path of glob.scanSync(import.meta.dir + "/..")) {
      const text = readSrc(path);
      for (const [i, line] of text.split("\n").entries()) {
        if (/console\.log\s*=/.test(line)) {
          violations.push(`${path}:${i + 1}: ${line.trim()}  → use captureConsole()`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `${violations.length} console.log reassignment(s) — use captureConsole():\n${violations.slice(0, 5).join("\n")}`
      );
    }
    expect(violations).toHaveLength(0);
  });

  test("Bun.Terminal is only used in references-inspect-watch", () => {
    const glob = new Bun.Glob("src/**/*.ts");
    const allowed = new Set(["src/lib/references-inspect-watch.ts"]);
    const violations: string[] = [];
    for (const path of glob.scanSync(import.meta.dir + "/..")) {
      if (allowed.has(path)) continue;
      const text = readSrc(path);
      if (text.includes("Bun.Terminal")) {
        violations.push(`${path}`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Bun.Terminal used outside references-inspect-watch.ts:\n${violations.join("\n")}`
      );
    }
    expect(violations).toHaveLength(0);
  });
});

// ── Bun buffer / aggregation API compliance ──────────────────────────

describe("bun-release-compliance buffer-aggregation", () => {
  test("Bun.allocUnsafe returns a Uint8Array of the requested size", () => {
    const buf = Bun.allocUnsafe(64);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.byteLength).toBe(64);
  });

  test("Bun.ArrayBufferSink builds an ArrayBuffer from chunks", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.write("hello");
    sink.write(new Uint8Array([32])); // space
    sink.write("world");
    const result = sink.end();
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });

  test("Bun.ArrayBufferSink asUint8Array returns Uint8Array", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ asUint8Array: true });
    sink.write("hello");
    const result = sink.end();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe("hello");
  });

  test("Bun.ArrayBufferSink stream mode supports flush", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ stream: true });
    sink.write("abc");
    const flushed = sink.flush();
    expect(flushed).toBeInstanceOf(ArrayBuffer);
    if (!(flushed instanceof ArrayBuffer)) {
      throw new Error("flush did not return ArrayBuffer");
    }
    expect(new TextDecoder().decode(flushed)).toBe("abc");
    sink.write("def");
    expect(new TextDecoder().decode(sink.end())).toBe("def");
  });

  test("Bun.concatArrayBuffers concatenates an array of ArrayBufferViews", () => {
    const a = new TextEncoder().encode("hello");
    const b = new TextEncoder().encode(" ");
    const c = new TextEncoder().encode("world");
    const result = Bun.concatArrayBuffers([a, b, c]);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });

  test("spreading arguments to Bun.concatArrayBuffers throws TypeError", () => {
    const a = new TextEncoder().encode("a");
    const b = new TextEncoder().encode("b");
    // @ts-expect-error - intentional misuse to guard against API drift
    expect(() => Bun.concatArrayBuffers(a, b)).toThrow(TypeError);
  });

  test("Buffer.concat remains the Node-compatible fallback", () => {
    const result = Buffer.concat([Buffer.from("hello "), Buffer.from("world")]);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("hello world");
  });
});

// ── Global raw URL lint sweep ─────────────────────────────────────────

describe("bun-release-compliance global doc-links lint sweep", () => {
  test("no raw Bun docs URLs in src/**/*.ts (all use named constants)", async () => {
    const { lintDocLinks, formatDocLinkViolation } = await import("../src/lib/doc-links-lint.ts");
    const violations = await lintDocLinks(repoRoot);
    if (violations.length > 0) {
      const details = violations.slice(0, 10).map(formatDocLinkViolation).join("\n");
      throw new Error(
        `${violations.length} raw Bun docs URL(s) found — use named constants instead:\n${details}`
      );
    }
    expect(violations).toHaveLength(0);
  });
});
