/**
 * Local echo servers for fetch protocol benchmarks (HTTP/1.1, HTTP/2, HTTP/3).
 *
 * TLS fixtures: __fixtures__/tls/localhost-{cert,key}.pem (self-signed, CN=localhost).
 */

import { join } from "path";

const TLS_DIR = join(import.meta.dir, "__fixtures__", "tls");
const FETCH_TLS = { rejectUnauthorized: false } as const;

export interface HttpBenchServers {
  h1Url: string;
  tlsUrl: string;
  h3Url: string | null;
  h2FetchSupported: boolean;
  stop(): void;
}

let active: HttpBenchServers | null = null;
let h2Probe: boolean | null = null;

async function probeFetchHttp2(tlsUrl: string): Promise<boolean> {
  if (h2Probe !== null) return h2Probe;
  try {
    const res = await fetch(tlsUrl, { protocol: "http2", tls: FETCH_TLS });
    h2Probe = res.ok && (await res.text()) === "ok";
  } catch {
    h2Probe = false;
  }
  return h2Probe;
}

/** True when fetch() accepts protocol: "http2" against the local TLS echo server. */
export async function fetchHttp2Supported(): Promise<boolean> {
  const servers = await getHttpBenchServers();
  return servers.h2FetchSupported;
}

/** Start or reuse localhost echo servers for protocol-pinned fetch benchmarks. */
export async function getHttpBenchServers(): Promise<HttpBenchServers> {
  if (active) return active;

  const cert = Bun.file(join(TLS_DIR, "localhost-cert.pem"));
  const key = Bun.file(join(TLS_DIR, "localhost-key.pem"));

  const h1 = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ok"),
  });

  const tls = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert, key },
    fetch: () => new Response("ok"),
  });

  let h3: ReturnType<typeof Bun.serve> | null = null;
  let h3Url: string | null = null;
  try {
    h3 = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert, key },
      http3: true,
      fetch: () => new Response("ok"),
    });
    h3Url = h3.url.href;
  } catch {
    h3Url = null;
  }

  const tlsUrl = tls.url.href;
  const h2FetchSupported = await probeFetchHttp2(tlsUrl);

  active = {
    h1Url: h1.url.href,
    tlsUrl,
    h3Url,
    h2FetchSupported,
    stop() {
      h1.stop();
      tls.stop();
      h3?.stop();
      active = null;
      h2Probe = null;
    },
  };

  return active;
}

export function stopHttpBenchServers(): void {
  active?.stop();
}

export async function benchFetchH1(servers: HttpBenchServers): Promise<void> {
  const res = await fetch(servers.h1Url, { protocol: "http1.1" });
  if (!res.ok || (await res.text()) !== "ok") {
    throw new Error("http.fetch-h1: unexpected response");
  }
}

export async function benchFetchH2(servers: HttpBenchServers): Promise<void> {
  const res = await fetch(servers.tlsUrl, { protocol: "http2", tls: FETCH_TLS });
  if (!res.ok || (await res.text()) !== "ok") {
    throw new Error("http.fetch-h2: unexpected response");
  }
}

export async function benchFetchH3(servers: HttpBenchServers): Promise<void> {
  if (!servers.h3Url) throw new Error("http.fetch-h3: HTTP/3 server unavailable");
  const res = await fetch(servers.h3Url, { protocol: "http3", tls: FETCH_TLS });
  if (!res.ok || (await res.text()) !== "ok") {
    throw new Error("http.fetch-h3: unexpected response");
  }
}
