/**
 * http-client.ts — Bun-native HTTP client with configurable TLS floor.
 *
 * Pins minimum TLS via Bun.fetch `tls.minVersion` (OpenSSL version codes).
 * Legacy equivalent: `https.Agent({ minVersion: "TLSv1.2" })`.
 *
 * @see {@link BUN_FETCH_TLS_DOC_URL}
 */

/** @see https://bun.com/docs/api/fetch#tls */
export const BUN_FETCH_TLS_DOC_URL = "https://bun.com/docs/api/fetch#tls";

/** Legacy Node agent option — superseded by {@link BUN_FETCH_TLS_DOC_URL}. */
export const BUN_HTTPS_AGENT_OPTIONS_DOC_URL = "https://bun.sh/reference/node/https/AgentOptions";

/** Legacy Node minVersion — superseded by {@link tlsMinVersionCode}. */
export const BUN_HTTPS_AGENT_MIN_VERSION_DOC_URL =
  "https://bun.sh/reference/node/https/AgentOptions/minVersion";

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TLSVersion = (typeof TLS_VERSIONS)[number];

const TLS_CODE_MAP: Record<TLSVersion, number> = {
  TLSv1: 0x0301,
  "TLSv1.1": 0x0302,
  "TLSv1.2": 0x0303,
  "TLSv1.3": 0x0304,
};

/** Map TLS version label to Bun.fetch `tls.minVersion` OpenSSL code. */
export function tlsMinVersionCode(version: TLSVersion): number {
  return TLS_CODE_MAP[version];
}

export interface HttpClientOptions {
  /** Production default minimum TLS version. */
  minTLS?: TLSVersion;
}

/** Bun.fetch TLS floor — runtime supports minVersion; types lag behind Bun docs. */
export type HttpFetchTls = Bun.TLSOptions & { minVersion?: number };

export interface FetchOptions extends RequestInit {
  /** Override the client's default TLS floor for this request. */
  minTLS?: TLSVersion;
  /** Bun.fetch TLS options (merged with minVersion floor). */
  tls?: HttpFetchTls;
}

export interface HttpClient {
  fetch(url: string, opts?: FetchOptions): Promise<Response>;
}

/** Create an HTTP client with a configurable minimum TLS version. */
export function makeHttpClient(options: HttpClientOptions = {}): HttpClient {
  const defaultMinTLS = options.minTLS ?? "TLSv1.2";

  return {
    fetch: async (url: string, opts: FetchOptions = {}): Promise<Response> => {
      const { minTLS, tls, ...rest } = opts;
      const minVersion = minTLS ?? defaultMinTLS;
      const init = {
        ...rest,
        tls: { ...tls, minVersion: tlsMinVersionCode(minVersion) },
      } as BunFetchRequestInit;
      return fetch(url, init);
    },
  };
}
