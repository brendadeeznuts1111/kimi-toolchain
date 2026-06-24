import { dns } from "bun";

/**
 * http-client.ts — Bun-native HTTP client with configurable TLS floor and fetch perf helpers.
 *
 * ## TLS
 * Pins minimum TLS via Bun.fetch `tls.minVersion` (OpenSSL version codes).
 * Legacy equivalent: `https.Agent({ minVersion: "TLSv1.2" })`.
 *
 * ## Connection warmup
 * Three standalone helpers — none auto-fire inside `makeHttpClient`:
 * - `prefetchDns(host, port?)` — warm DNS only (30 s TTL, fire-and-forget, never throws)
 * - `preconnect(url)` — warm DNS + TCP + TLS (use when there's a gap before first request)
 * - `warmConnections({ dnsPrefetch?, preconnect? })` — batch multiple hosts in one call
 *
 * When to use which:
 * | Scenario | Helper |
 * |---|---|
 * | Burst of requests to same host | `prefetchDns` |
 * | Module init → request 2–10 s later | `preconnect` |
 * | Multiple hosts at startup | `warmConnections` |
 *
 * @see {@link BUN_FETCH_TLS_DOC_URL}
 * @see https://bun.com/docs/runtime/networking/fetch#performance
 */

/** @see https://bun.com/docs/api/fetch#tls */
export const BUN_FETCH_TLS_DOC_URL = "https://bun.com/docs/api/fetch#tls";

/** Legacy Node agent option — superseded by {@link BUN_FETCH_TLS_DOC_URL}. */
export const BUN_HTTPS_AGENT_OPTIONS_DOC_URL = "https://bun.com/reference/node/https/AgentOptions";

/** Legacy Node minVersion — superseded by {@link tlsMinVersionCode}. */
export const BUN_HTTPS_AGENT_MIN_VERSION_DOC_URL =
  "https://bun.com/reference/node/https/AgentOptions/minVersion";

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TlsVersion = (typeof TLS_VERSIONS)[number];

const TLS_CODE_MAP: Record<TlsVersion, number> = {
  TLSv1: 0x0301,
  "TLSv1.1": 0x0302,
  "TLSv1.2": 0x0303,
  "TLSv1.3": 0x0304,
};

/** Map TLS version label to Bun.fetch `tls.minVersion` OpenSSL code. */
export function tlsMinVersionCode(version: TlsVersion): number {
  return TLS_CODE_MAP[version];
}

export interface HttpClientOptions {
  /** Production default minimum TLS version. */
  minTls?: TlsVersion;
  /**
   * Whether to reuse pooled TCP connections (Bun default: true).
   * Set to `false` for one-shot scripts where the overhead of keeping
   * the socket open isn't worth it.
   * Per-request override: `keepalive: false` in `FetchOptions`.
   */
  keepalive?: boolean;
  /** Default proxy for all requests. Per-request override: `proxy` in `FetchOptions`. */
  proxy?: string | ProxyConfig;
  /** Default Unix socket path. Per-request override: `unix` in `FetchOptions`. */
  unix?: string;
  /** Default decompress setting (Bun default: true). */
  decompress?: boolean;
  /** Default verbose logging level. */
  verbose?: boolean | "curl";
}

/** Bun.fetch TLS floor — runtime supports minVersion; types lag behind Bun docs. */
export type HttpFetchTls = Bun.TLSOptions & { minVersion?: number };

/** Bun-specific proxy configuration. @see https://bun.com/docs/runtime/networking/fetch#proxying-requests */
export interface ProxyConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface FetchOptions extends RequestInit {
  /** Override the client's default TLS floor for this request. */
  minTls?: TlsVersion;
  /** Bun.fetch TLS options (merged with minVersion floor). */
  tls?: HttpFetchTls;
  /** Override the client's default keep-alive for this request. */
  keepalive?: boolean;
  /** Bun proxy: string URL or { url, headers } object. @see https://bun.com/docs/runtime/networking/fetch#proxying-requests */
  proxy?: string | ProxyConfig;
  /** Unix domain socket path for the request. @see https://bun.com/docs/runtime/networking/fetch#unix-domain-sockets */
  unix?: string;
  /** Control automatic response decompression (default: true). Supports gzip, deflate, br, zstd. */
  decompress?: boolean;
  /** Debug logging: true for basic, "curl" for detailed output. @see https://bun.com/docs/runtime/networking/fetch#debugging */
  verbose?: boolean | "curl";
}

/**
 * Warm the DNS cache for a host before a burst of requests (30 s TTL).
 * No-op if already cached. Call before sequential loops against a fixed host.
 * The optional port parameter pre-warms the DNS entry for a specific port,
 * which Bun uses to optimize connection establishment.
 * @see https://bun.com/docs/runtime/networking/dns#dns.prefetch
 */
export function prefetchDns(host: string, port?: number): void {
  if (port !== undefined) {
    (dns.prefetch as (host: string, port: number) => void)(host, port);
  } else {
    dns.prefetch(host);
  }
}

/**
 * Pre-establish TCP + TLS to a host before making requests.
 * Only effective when there is a gap between this call and the first request.
 * CLI equivalent: `bun --fetch-preconnect <url> ./script.ts`
 * @see https://bun.com/docs/runtime/networking/fetch#performance
 */
export function preconnect(url: string): void {
  try {
    (fetch as unknown as { preconnect?: (url: string) => void }).preconnect?.(url);
  } catch {
    /* fire-and-forget — invalid URLs or unsupported Bun versions are silently ignored */
  }
}

export interface WarmupOptions {
  /** Hostnames to DNS-prefetch (e.g. "api.osv.dev"). */
  dnsPrefetch?: string[];
  /** Full URLs to TCP+TLS preconnect (e.g. "https://api.cloudflare.com"). */
  preconnect?: string[];
}

/**
 * Warm DNS and/or TCP+TLS connections for multiple hosts in one call.
 * Fire-and-forget — does not throw on unreachable hosts.
 *
 * @example
 * ```ts
 * warmConnections({
 *   dnsPrefetch: ["api.osv.dev"],
 *   preconnect: ["https://api.cloudflare.com"],
 * });
 * ```
 */
export function warmConnections(opts: WarmupOptions): void {
  for (const host of opts.dnsPrefetch ?? []) prefetchDns(host);
  for (const url of opts.preconnect ?? []) preconnect(url);
}

/**
 * Create an HTTP client with configurable TLS floor, keep-alive, proxy, and debugging.
 *
 * Connection pooling and keep-alive are enabled by Bun by default.
 * Disable with `keepalive: false` for one-shot scripts.
 *
 * @see https://bun.com/docs/runtime/networking/fetch#request-options
 */
export function makeHttpClient(options: HttpClientOptions = {}) {
  const defaultMinTls = options.minTls ?? "TLSv1.2";
  const defaultKeepalive = options.keepalive ?? true;

  return {
    fetch: async (url: string, opts: FetchOptions = {}): Promise<Response> => {
      const { minTls, tls, keepalive, proxy, unix, decompress, verbose, ...rest } = opts;
      const minVersion = minTls ?? defaultMinTls;
      const init = {
        ...rest,
        keepalive: keepalive ?? defaultKeepalive,
        tls: { ...tls, minVersion: tlsMinVersionCode(minVersion) },
        ...((proxy ?? options.proxy) ? { proxy: proxy ?? options.proxy } : {}),
        ...((unix ?? options.unix) ? { unix: unix ?? options.unix } : {}),
        ...(decompress !== undefined
          ? { decompress }
          : options.decompress !== undefined
            ? { decompress: options.decompress }
            : {}),
        ...(verbose !== undefined
          ? { verbose }
          : options.verbose !== undefined
            ? { verbose: options.verbose }
            : {}),
      } as BunFetchRequestInit;
      return fetch(url, init);
    },
  };
}
