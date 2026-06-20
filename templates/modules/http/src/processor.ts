// templates/modules/http/src/processor.ts
// Configurable TLS-floor HTTP client — registered under Symbol.for("kimi.effect.http")

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TLSVersion = (typeof TLS_VERSIONS)[number];

const TLS_CODE_MAP: Record<TLSVersion, number> = {
  TLSv1: 0x0301,
  "TLSv1.1": 0x0302,
  "TLSv1.2": 0x0303,
  "TLSv1.3": 0x0304,
};

function tlsMinVersionCode(version: TLSVersion): number {
  return TLS_CODE_MAP[version];
}

export interface HttpProcessorConfig {
  minTLS?: TLSVersion;
}

export interface FetchOptions extends RequestInit {
  minTLS?: TLSVersion;
  tls?: Bun.TLSOptions;
}

export function createHttpProcessor(config: HttpProcessorConfig = {}) {
  const defaultMinTLS = config.minTLS ?? "TLSv1.2";

  return {
    fetch: (url: string, opts: FetchOptions = {}) => {
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
