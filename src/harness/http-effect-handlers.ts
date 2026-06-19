/**
 * http-effect-handlers.ts — TLS-version benchmarks for the HTTP client.
 *
 * Registers benchmarks for TLS 1.3 / 1.2 handshakes and rejection of TLS 1.1 / 1.0.
 * Network fixtures default to badssl.com; benchmarks are skipped when the host
 * is unreachable so the gate stays green in offline or restricted environments.
 */

import { registerEffectBenchmark } from "../lib/effect-benchmark.ts";
import { makeHttpClient } from "../lib/http-client.ts";

const client = makeHttpClient({ minTLS: "TLSv1.2" });

const TLS_TEST_URLS = {
  tls13: Bun.env.KIMI_TLS_TEST_TLS13_URL ?? "https://www.cloudflare.com/",
  tls12: Bun.env.KIMI_TLS_TEST_TLS12_URL ?? "https://tls-v1-2.badssl.com:1012/",
  tls11: Bun.env.KIMI_TLS_TEST_TLS11_URL ?? "https://tls-v1-1.badssl.com:1011/",
  tls10: Bun.env.KIMI_TLS_TEST_TLS10_URL ?? "https://tls-v1-0.badssl.com:1010/",
};

async function hostReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

registerEffectBenchmark({
  registryKey: "httpClient.fetch-tls1.3",
  symbol: "kimi.effect.http",
  thresholdMs: 500,
  workload: async () => {
    await client.fetch(TLS_TEST_URLS.tls13, { minTLS: "TLSv1.3" });
  },
  skipIf: async () => !(await hostReachable(TLS_TEST_URLS.tls13)),
  skipReason: "TLS 1.3 test endpoint unreachable",
});

registerEffectBenchmark({
  registryKey: "httpClient.fetch-tls1.2",
  symbol: "kimi.effect.http",
  thresholdMs: 500,
  workload: async () => {
    await client.fetch(TLS_TEST_URLS.tls12, { minTLS: "TLSv1.2" });
  },
  skipIf: async () => !(await hostReachable(TLS_TEST_URLS.tls12)),
  skipReason: "TLS 1.2 test endpoint unreachable",
});

registerEffectBenchmark({
  registryKey: "httpClient.fetch-tls1.1-reject",
  symbol: "kimi.effect.http",
  thresholdMs: 500,
  workload: async () => {
    try {
      await client.fetch(TLS_TEST_URLS.tls11, { minTLS: "TLSv1.2" });
    } catch {
      // Expected: TLS 1.1 handshake rejected by the policy floor.
      return;
    }
    throw new Error("TLS 1.1 handshake was accepted below policy floor");
  },
});

registerEffectBenchmark({
  registryKey: "httpClient.fetch-tls1.0-reject",
  symbol: "kimi.effect.http",
  thresholdMs: 500,
  workload: async () => {
    try {
      await client.fetch(TLS_TEST_URLS.tls10, { minTLS: "TLSv1.2" });
    } catch {
      // Expected: TLS 1.0 handshake rejected by the policy floor.
      return;
    }
    throw new Error("TLS 1.0 handshake was accepted below policy floor");
  },
});
