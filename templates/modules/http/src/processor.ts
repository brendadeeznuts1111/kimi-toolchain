// templates/modules/http/src/processor.ts
// Configurable TLS-floor HTTP client — registered via registerEffect("http") in init.ts

export const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
export type TlsVersion = (typeof TLS_VERSIONS)[number];

const TLS_CODE_MAP: Record<TlsVersion, number> = {
  TLSv1: 0x0301,
  "TLSv1.1": 0x0302,
  "TLSv1.2": 0x0303,
  "TLSv1.3": 0x0304,
};

function tlsMinVersionCode(version: TlsVersion): number {
  return TLS_CODE_MAP[version];
}

export interface HttpProcessorConfig {
  minTls?: TlsVersion;
}

export interface FetchOptions extends RequestInit {
  minTls?: TlsVersion;
  tls?: Bun.TLSOptions;
}

export function createHttpProcessor(config: HttpProcessorConfig = {}) {
  const defaultMinTls = config.minTls ?? "TLSv1.2";

  return {
    fetch: (url: string, opts: FetchOptions = {}) => {
      const { minTls, tls, ...rest } = opts;
      const minVersion = minTls ?? defaultMinTls;
      const init = {
        ...rest,
        tls: { ...tls, minVersion: tlsMinVersionCode(minVersion) },
      } as BunFetchRequestInit;
      return fetch(url, init);
    },
  };
}
