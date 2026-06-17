/**
 * webview-console.ts — Bun.WebView console capture, normalization, and probes.
 *
 * @see https://bun.sh/docs/runtime/webview
 */

import { fileUrlFromPath } from "./bun-utils.ts";
import { inspectAgent } from "./inspect.ts";
import {
  FRONTMATTER_TABLE_DEPTH,
  frontmatterPreviewDataUrl,
  parseFrontmatterFile,
  type ParsedFrontmatter,
} from "./frontmatter.ts";

export type WebViewConsoleType = "log" | "warn" | "error" | "info" | "debug" | string;

export interface WebViewConsoleEvent {
  type: WebViewConsoleType;
  args: unknown[];
  timestamp: string;
}

export interface CdpRemoteObject {
  type?: string;
  subtype?: string;
  className?: string;
  description?: string;
  value?: unknown;
  preview?: {
    description?: string;
    properties?: Array<{ name: string; value?: unknown; type?: string }>;
  };
}

export interface WebViewConsoleCollector {
  handler: (type: string, ...args: unknown[]) => void;
  readonly events: WebViewConsoleEvent[];
  drain: () => WebViewConsoleEvent[];
}

export interface WebViewConsoleCaptureOptions {
  url: string;
  mirror?: boolean;
  script?: string;
  waitMs?: number;
  backend?: Bun.WebView.ConstructorOptions["backend"];
  depth?: number;
}

export interface WebViewConsoleCaptureResult {
  events: WebViewConsoleEvent[];
  url: string;
  title: string;
  mirrored: boolean;
}

export interface WebViewCliArgs {
  mode: "open" | "frontmatter";
  target: string;
  mirror: boolean;
  json: boolean;
  depth: number;
  script?: string;
  waitMs: number;
  backend?: "webkit" | "chrome";
}

const DEFAULT_WAIT_MS = 100;

/** True when Bun.WebView is available in this runtime. */
export function webViewSupported(): boolean {
  return typeof Bun.WebView === "function";
}

/**
 * Chrome backend only — subscribe to a CDP event (event `type` is the CDP method name;
 * `event.data` is the parsed params object).
 * @see https://bun.sh/docs/runtime/webview#cdp
 */
export function addChromeCdpListener(
  view: Bun.WebView,
  cdpEventName: string,
  onParams: (params: unknown) => void
): () => void {
  const handler = (event: Event) => onParams((event as MessageEvent).data);
  view.addEventListener(cdpEventName, handler);
  return () => view.removeEventListener(cdpEventName, handler);
}

/** Subscribe to one or more named CDP events on the Chrome backend. */
export function tapChromeCdpEvents(
  view: Bun.WebView,
  eventNames: readonly string[],
  onCdp: (method: string, params: unknown) => void
): () => void {
  const detach = eventNames.map((name) =>
    addChromeCdpListener(view, name, (params) => onCdp(name, params))
  );
  return () => detach.forEach((fn) => fn());
}

/** Spawn a fresh headless Chrome — skips auto-connect to an existing browser. */
export function spawnChromeBackend(
  extra?: Omit<Extract<Bun.WebView.ConstructorOptions["backend"], { type: "chrome" }>, "type">
): Bun.WebView.ConstructorOptions["backend"] {
  return { type: "chrome", url: false, ...extra };
}

export function chromeWebViewBackend(
  backend: Bun.WebView.ConstructorOptions["backend"] | undefined
): boolean {
  if (!backend) return defaultWebViewBackend() === "chrome";
  if (backend === "chrome") return true;
  return typeof backend === "object" && backend.type === "chrome";
}

/** Default backend: webkit on macOS, chrome elsewhere. */
export function defaultWebViewBackend(): "webkit" | "chrome" {
  return process.platform === "darwin" ? "webkit" : "chrome";
}

function isCdpRemoteObject(value: Record<string, unknown>): boolean {
  return (
    typeof value.type === "string" &&
    (value.description !== undefined ||
      value.preview !== undefined ||
      value.className !== undefined)
  );
}

function unwrapCdpRemoteObject(remote: CdpRemoteObject): unknown {
  if (remote.value !== undefined) return remote.value;
  if (remote.preview?.properties?.length) {
    const out: Record<string, unknown> = {};
    for (const prop of remote.preview.properties) {
      out[prop.name] = prop.value ?? prop.type ?? null;
    }
    return out;
  }
  const description = remote.description;
  if (typeof description === "string") {
    if (description.startsWith("{") || description.startsWith("[")) {
      try {
        return JSON.parse(description) as unknown;
      } catch {
        /* fall through */
      }
    }
    return description;
  }
  return remote;
}

/** Normalize a single WebView console argument (primitive, WebKit JSON, or CDP RemoteObject). */
export function unwrapWebViewConsoleArg(arg: unknown): unknown {
  if (arg === null || arg === undefined) return arg;
  const kind = typeof arg;
  if (kind === "string" || kind === "number" || kind === "boolean" || kind === "bigint") {
    return arg;
  }
  if (Array.isArray(arg)) {
    return arg.map(unwrapWebViewConsoleArg);
  }
  if (kind === "object") {
    const record = arg as Record<string, unknown>;
    if (isCdpRemoteObject(record)) {
      return unwrapCdpRemoteObject(record as CdpRemoteObject);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = unwrapWebViewConsoleArg(value);
    }
    return out;
  }
  return arg;
}

/** Collect page console calls via a custom handler (structured, Bun.inspect-friendly). */
export function createWebViewConsoleCollector(): WebViewConsoleCollector {
  const events: WebViewConsoleEvent[] = [];
  const handler = (type: string, ...args: unknown[]) => {
    events.push({
      type,
      args: args.map(unwrapWebViewConsoleArg),
      timestamp: new Date().toISOString(),
    });
  };
  return {
    handler,
    get events() {
      return events;
    },
    drain: () => events.splice(0),
  };
}

/** Format one console argument for human output with explicit inspect depth. */
export function formatWebViewConsoleArg(value: unknown, depth = FRONTMATTER_TABLE_DEPTH): string {
  if (value !== null && typeof value === "object") {
    return Bun.inspect(value, { colors: false, depth });
  }
  return String(value);
}

/** Format captured events as plain lines (one per console call). */
export function formatWebViewConsoleEvents(
  events: WebViewConsoleEvent[],
  depth = FRONTMATTER_TABLE_DEPTH
): string {
  return events
    .map((event) => {
      const body = event.args.map((arg) => formatWebViewConsoleArg(arg, depth)).join(" ");
      return `[${event.type}] ${body}`;
    })
    .join("\n");
}

function resolveTargetUrl(target: string): string {
  if (/^https?:\/\//i.test(target) || target.startsWith("data:")) {
    return target;
  }
  return fileUrlFromPath(target).href;
}

/** Parse `kimi-debug webview` argv. */
export function parseWebViewCliArgs(argv: string[]): WebViewCliArgs | { error: string } {
  let mode: WebViewCliArgs["mode"] = "open";
  let target = "";
  let mirror = false;
  let json = false;
  let depth = FRONTMATTER_TABLE_DEPTH;
  let script: string | undefined;
  let waitMs = DEFAULT_WAIT_MS;
  let backend: WebViewCliArgs["backend"];

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--mirror") {
      mirror = true;
      continue;
    }
    if (arg === "--depth") {
      const next = argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { error: `Invalid --depth: ${next ?? ""}` };
      }
      depth = parsed;
      continue;
    }
    if (arg === "--wait") {
      const next = argv[++i];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { error: `Invalid --wait: ${next ?? ""}` };
      }
      waitMs = parsed;
      continue;
    }
    if (arg === "--script" || arg === "--eval") {
      script = argv[++i];
      if (!script) return { error: `Missing value for ${arg}` };
      continue;
    }
    if (arg === "--backend") {
      const next = argv[++i];
      if (next !== "webkit" && next !== "chrome") {
        return { error: `Invalid --backend: ${next ?? ""} (webkit | chrome)` };
      }
      backend = next;
      continue;
    }
    if (arg.startsWith("-")) {
      return { error: `Unknown flag: ${arg}` };
    }
    positional.push(arg);
  }

  if (positional[0] === "frontmatter") {
    mode = "frontmatter";
    target = positional[1] ?? "";
  } else {
    target = positional[0] ?? "";
  }

  if (!target) {
    return { error: "Missing target (url, file path, or frontmatter file)" };
  }
  return { mode, target, mirror, json, depth, script, waitMs, backend };
}

/** Load a page in Bun.WebView and capture or mirror console output. */
export async function runWebViewConsoleCapture(
  options: WebViewConsoleCaptureOptions
): Promise<WebViewConsoleCaptureResult> {
  if (!webViewSupported()) {
    throw new Error("Bun.WebView is not available in this runtime");
  }

  const collector = createWebViewConsoleCollector();
  const mirrored = options.mirror === true;
  const backend = options.backend ?? defaultWebViewBackend();

  await using view = new Bun.WebView({
    width: 800,
    height: 600,
    backend,
    console: mirrored ? globalThis.console : collector.handler,
  });

  await view.navigate(options.url);
  if (options.script) {
    await view.evaluate(options.script);
  }
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  if (waitMs > 0) {
    await Bun.sleep(waitMs);
  }

  return {
    events: mirrored ? [] : [...collector.events],
    url: view.url,
    title: view.title,
    mirrored,
  };
}

/** Open a url/file and return normalized console events. */
export async function probeWebViewConsole(
  target: string,
  opts?: Omit<WebViewConsoleCaptureOptions, "url">
): Promise<WebViewConsoleCaptureResult> {
  return runWebViewConsoleCapture({
    url: resolveTargetUrl(target),
    ...opts,
  });
}

export interface WebViewFrontmatterProbeResult {
  parsed: ParsedFrontmatter;
  capture: WebViewConsoleCaptureResult;
}

/** Parse a markdown file, render preview HTML, and capture page console output. */
export async function probeWebViewFrontmatter(
  filePath: string,
  opts?: Omit<WebViewConsoleCaptureOptions, "url">
): Promise<WebViewFrontmatterProbeResult> {
  const parsed = await parseFrontmatterFile(filePath);
  const capture = await runWebViewConsoleCapture({
    url: frontmatterPreviewDataUrl(parsed),
    ...opts,
  });
  return { parsed, capture };
}

/** Serialize capture result for --json output. */
export function webViewConsoleAgentPayload(
  result: WebViewConsoleCaptureResult,
  meta: Record<string, unknown> = {}
): string {
  return inspectAgent({
    schemaVersion: 1,
    tool: "kimi-debug",
    command: "webview",
    level: "info",
    timestamp: new Date().toISOString(),
    events: result.events,
    page: { url: result.url, title: result.title },
    mirrored: result.mirrored,
    meta,
  });
}
