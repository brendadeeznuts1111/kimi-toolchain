import { describe, expect, test, afterEach } from "bun:test";
import {
  benchFetchH1,
  benchFetchH3,
  fetchHttp2Supported,
  getHttpBenchServers,
  stopHttpBenchServers,
} from "../http-bench.ts";
import { runEffectBenchmarks } from "../perf-monitor.ts";
import { DEFAULT_THRESHOLDS } from "../module-registry.ts";

afterEach(() => {
  stopHttpBenchServers();
});

describe("http-bench", () => {
  test("starts localhost echo servers", async () => {
    const servers = await getHttpBenchServers();
    expect(servers.h1Url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(servers.tlsUrl).toMatch(/^https:\/\/127\.0\.0\.1:/);
  });

  test("benchFetchH1 round-trips via protocol http1.1", async () => {
    const servers = await getHttpBenchServers();
    await benchFetchH1(servers);
  });

  test("benchFetchH3 round-trips when HTTP/3 serve is available", async () => {
    const servers = await getHttpBenchServers();
    if (!servers.h3Url) return;
    await benchFetchH3(servers);
  });

  test("fetchHttp2Supported returns boolean", async () => {
    const supported = await fetchHttp2Supported();
    expect(typeof supported).toBe("boolean");
  });
});

describe("http registry workloads", () => {
  test("runEffectBenchmarks includes http.fetch-h1", async () => {
    const metrics = await runEffectBenchmarks();
    const h1 = metrics.find((m) => m.registryKey === "http.fetch-h1");
    expect(h1).toBeDefined();
    expect(h1!.pass).toBe(true);
    expect(h1!.thresholdMs).toBe(DEFAULT_THRESHOLDS["kimi.effect.http.fetch-h1"]);
  });

  test("http.fetch-h2 skips when client unavailable", async () => {
    const metrics = await runEffectBenchmarks();
    const h2 = metrics.find((m) => m.registryKey === "http.fetch-h2");
    expect(h2).toBeDefined();
    const supported = await fetchHttp2Supported();
    if (supported) {
      expect(h2!.skipped).toBeUndefined();
      expect(h2!.pass).toBe(true);
    } else {
      expect(h2!.skipped).toBe(true);
      expect(h2!.pass).toBe(true);
    }
  });
});
