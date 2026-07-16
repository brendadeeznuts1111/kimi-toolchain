/**
 * Bun Docs MCP — Bun.WebView bridge.
 *
 * Queries the Bun documentation MCP and opens the matching official docs page
 * in a native Bun.WebView window.
 *
 * @see https://bun.com/docs/runtime/webview
 */

import {
  formatBunDocsContent,
  queryBunDocsFilesystem,
  searchBunDocs,
  type BunDocsSearchResult,
} from "./bun-docs-mcp.ts";
import { webViewConsoleMirror, webViewSupported } from "./webview-console.ts";

export const BUN_DOCS_ROOT_URL = "https://bun.com/docs";

export type BunDocsWebViewTool = "search_bun" | "query_docs_filesystem_bun" | "submit_feedback";

export interface BunDocsWebViewOptions {
  /** Query or filesystem command to send to the Bun docs MCP. */
  query: string;
  /** Which Bun docs MCP tool to use. Defaults to `search_bun`. */
  tool?: BunDocsWebViewTool;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Bypass the MCP cache and fetch fresh results. */
  refresh?: boolean;
  /** Window width. */
  width?: number;
  /** Window height. */
  height?: number;
  /** WebView backend override. */
  backend?: Bun.WebView.ConstructorOptions["backend"];
  /** Open this URL directly instead of resolving one from the MCP result. */
  url?: string;
}

export interface BunDocsWebViewResult {
  ok: boolean;
  url: string;
  error?: string;
}

const TRAILING_URL_PUNCTUATION = /[,;.!]+$/;

function trimTrailingPunctuation(url: string): string {
  return url.replace(TRAILING_URL_PUNCTUATION, "");
}

/** Extract the first Bun docs URL from MCP text output. */
export function extractBunDocsUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/bun\.com\/(?:docs\/|guides\/)[^\s"'<>)\]}]+/);
  return match ? trimTrailingPunctuation(match[0]) : undefined;
}

/** Pick a docs URL from a Bun docs MCP search result, falling back to the root. */
export function resolveBunDocsUrlFromSearch(result: BunDocsSearchResult): {
  url: string;
  fallback: boolean;
  error?: string;
} {
  if (!result.ok) {
    return { url: BUN_DOCS_ROOT_URL, fallback: true, error: result.error };
  }
  const text = formatBunDocsContent(result.content);
  const url = extractBunDocsUrl(text);
  return url ? { url, fallback: false } : { url: BUN_DOCS_ROOT_URL, fallback: true };
}

/** Build constructor options for a Bun docs WebView window. */
export function buildBunDocsWebViewOptions(
  url: string,
  options: Pick<BunDocsWebViewOptions, "width" | "height" | "backend"> = {}
): Bun.WebView.ConstructorOptions {
  return {
    url,
    width: options.width ?? 1280,
    height: options.height ?? 800,
    backend: options.backend,
    console: webViewConsoleMirror(),
  };
}

async function resolveBunDocsUrlFromOptions(
  options: BunDocsWebViewOptions
): Promise<{ url: string; fallback: boolean; error?: string }> {
  if (options.url) {
    return { url: options.url, fallback: false };
  }

  const tool = options.tool ?? "search_bun";
  const timeoutMs = options.timeoutMs ?? 30000;
  const result =
    tool === "query_docs_filesystem_bun"
      ? await queryBunDocsFilesystem(options.query, timeoutMs, { refresh: options.refresh })
      : await searchBunDocs(options.query, timeoutMs, { refresh: options.refresh });

  return resolveBunDocsUrlFromSearch(result);
}

function bindShutdownSignal(): { controller: AbortController; onSignal: () => void } {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  controller.signal.addEventListener(
    "abort",
    () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
    { once: true }
  );
  return { controller, onSignal };
}

/**
 * Open a Bun.WebView to the docs page resolved from the query.
 *
 * Blocks until the window is closed or the process receives SIGINT/SIGTERM.
 */
export async function runBunDocsWebView(
  options: BunDocsWebViewOptions
): Promise<BunDocsWebViewResult> {
  if (!webViewSupported()) {
    return { ok: false, url: "", error: "Bun.WebView is not available in this runtime" };
  }

  const { url, fallback, error } = await resolveBunDocsUrlFromOptions(options);
  const { controller, onSignal } = bindShutdownSignal();
  const viewOptions = buildBunDocsWebViewOptions(url, options);

  try {
    process.stderr.write(`[bun-docs] opening WebView ${url}${fallback ? " (fallback)" : ""}\n`);
    await using view = new Bun.WebView(viewOptions);
    void view;
    while (!controller.signal.aborted) {
      await Bun.sleep(60_000);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  return { ok: true, url, ...(error ? { error } : {}) };
}
