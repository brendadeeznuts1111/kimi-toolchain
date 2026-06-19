// templates/modules/http/src/processor.ts
// Configurable TLS-floor HTTP client — registered under Symbol.for("kimi.effect.http")

import https from "node:https";

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TLSVersion = (typeof TLS_VERSIONS)[number];

export interface HttpProcessorConfig {
  minTLS?: TLSVersion;
}

export interface FetchOptions extends RequestInit {
  minTLS?: TLSVersion;
}

export function createHttpProcessor(config: HttpProcessorConfig = {}) {
  const defaultMinTLS = config.minTLS ?? "TLSv1.2";

  return {
    fetch: (url: string, opts: FetchOptions = {}) => {
      const minVersion = opts.minTLS ?? defaultMinTLS;
      const agent = new https.Agent({ minVersion });
      return fetch(url, { ...opts, agent } as RequestInit);
    },
  };
}
