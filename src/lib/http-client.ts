/**
 * http-client.ts — Bun-native HTTP client with configurable TLS floor.
 *
 * Provides a production-safe fetch wrapper that lets callers pin the minimum
 * TLS version. Uses Node's https.Agent only for the TLS floor; everything else
 * is plain fetch.
 *
 * @see {@link BUN_HTTPS_AGENT_OPTIONS_DOC_URL} — `https.AgentOptions` (`minVersion`, `maxVersion`, …)
 */

import https from "node:https";

/** @see {@link BUN_HTTPS_AGENT_OPTIONS_DOC_URL} */
export const BUN_HTTPS_AGENT_OPTIONS_DOC_URL = "https://bun.sh/reference/node/https/AgentOptions";

/** @see {@link BUN_HTTPS_AGENT_MIN_VERSION_DOC_URL} */
export const BUN_HTTPS_AGENT_MIN_VERSION_DOC_URL = "https://bun.sh/reference/node/https/AgentOptions/minVersion";

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TLSVersion = (typeof TLS_VERSIONS)[number];

export interface HttpClientOptions {
  /** Production default minimum TLS version. */
  minTLS?: TLSVersion;
}

export interface FetchOptions extends RequestInit {
  /** Override the client's default TLS floor for this request. */
  minTLS?: TLSVersion;
}

export interface HttpClient {
  fetch(url: string, opts?: FetchOptions): Promise<Response>;
}

/** Create an HTTP client with a configurable minimum TLS version. */
export function makeHttpClient(options: HttpClientOptions = {}): HttpClient {
  const defaultMinTLS = options.minTLS ?? "TLSv1.2";

  return {
    fetch: async (url: string, opts: FetchOptions = {}): Promise<Response> => {
      const minVersion = opts.minTLS ?? defaultMinTLS;
      // https.AgentOptions.minVersion — default TLSv1.2; CLI --tls-min-v1.3 overrides globally
      const agent = new https.Agent({ minVersion });
      return fetch(url, { ...opts, agent } as RequestInit);
    },
  };
}
