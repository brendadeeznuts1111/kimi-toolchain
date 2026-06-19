import type { ModuleRegistryEntry } from "./types.ts";
import { ISOLATION_PERF_WORKLOADS } from "../lib/isolation/index.ts";
import {
  benchFileServeFull,
  benchFileServeRange,
  getFileBenchServer,
} from "./file-bench.ts";
import {
  benchFetchH1,
  benchFetchH2,
  benchFetchH3,
  getHttpBenchServers,
} from "./http-bench.ts";
import {
  benchMinimalInstall,
  installBenchAvailable,
  installBenchEnabled,
} from "./install-bench.ts";

/** Built-in default thresholds — overridden by trained thresholds.json when present. */
export const DEFAULT_THRESHOLDS: Record<string, number> = {
  "kimi.effect.crypto.sha256": 5,
  "kimi.effect.util.inspect": 2,
  "kimi.effect.util.deepEquals": 5,
  "kimi.effect.image.metadata": 10,
  "kimi.effect.http.fetch-h1": 50,
  "kimi.effect.http.fetch-h2": 40,
  "kimi.effect.http.fetch-h3": 35,
  "kimi.effect.fileServer.serve-full": 50,
  "kimi.effect.fileServer.serve-range": 50,
  "kimi.effect.packageInstall.install-minimal": 500,
  "kimi.effect.isolation.realmEvaluate": 5,
  "kimi.effect.isolation.createChannel": 50,
  "kimi.effect.isolation.roundtrip": 100,
  "kimi.effect.isolation.realm.run": 10,
  "kimi.effect.isolation.worker.run": 100,
  "kimi.effect.clock": 0.05,
  "kimi.effect.uuid": 0.1,
};

/** Symbol-keyed workloads — threshold lookup uses `kimi.effect.${registryKey}`. */
export const MODULE_REGISTRY: Record<string, ModuleRegistryEntry> = {
  ...Object.fromEntries(
    Object.entries(ISOLATION_PERF_WORKLOADS).map(([key, entry]) => [
      key,
      { symbol: entry.symbol, thresholdMs: entry.thresholdMs, workload: entry.workload },
    ])
  ),
  "crypto.sha256": {
    symbol: "kimi.effect.crypto",
    thresholdMs: 5,
    workload: () => {
      Bun.SHA256.hash("benchmark payload ".repeat(10));
    },
  },
  "util.inspect": {
    symbol: "kimi.effect.inspect",
    thresholdMs: 2,
    workload: () => {
      Bun.inspect({ nested: { a: 1, b: { c: [1, 2, 3] } } }, { sorted: true, colors: false });
    },
  },
  "util.deepEquals": {
    symbol: "kimi.effect.equals",
    thresholdMs: 5,
    workload: () => {
      Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
    },
  },
  "image.metadata": {
    symbol: "kimi.effect.image",
    thresholdMs: 10,
    workload: async () => {
      const png = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2,
        0, 0, 0, 0xfd, 0xd4, 0x9a, 0x73, 0, 0, 0, 18, 73, 68, 65, 84, 8, 0, 0xd7, 99, 0xf8, 0xcf,
        0xc0, 0, 2, 12, 0, 0, 9, 0, 1, 0x35, 0x8b, 0x5a, 0xc0, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 66,
        0x96, 130,
      ]);
      await new Bun.Image(png).metadata();
    },
  },
  "http.fetch-h1": {
    symbol: "kimi.effect.http",
    thresholdMs: 50,
    workload: async () => {
      const servers = await getHttpBenchServers();
      await benchFetchH1(servers);
    },
  },
  "http.fetch-h2": {
    symbol: "kimi.effect.http",
    thresholdMs: 40,
    skipReason: "fetch({ protocol: 'http2' }) unavailable on this Bun build",
    skipIf: async () => !(await getHttpBenchServers()).h2FetchSupported,
    workload: async () => {
      const servers = await getHttpBenchServers();
      await benchFetchH2(servers);
    },
  },
  "http.fetch-h3": {
    symbol: "kimi.effect.http",
    thresholdMs: 35,
    skipReason: "Bun.serve http3 or fetch({ protocol: 'http3' }) unavailable",
    skipIf: async () => !(await getHttpBenchServers()).h3Url,
    workload: async () => {
      const servers = await getHttpBenchServers();
      await benchFetchH3(servers);
    },
  },
  "file.serve-full": {
    symbol: "kimi.effect.fileServer",
    thresholdMs: 50,
    workload: async () => {
      const server = await getFileBenchServer();
      await benchFileServeFull(server);
    },
  },
  "file.serve-range": {
    symbol: "kimi.effect.fileServer",
    thresholdMs: 50,
    workload: async () => {
      const server = await getFileBenchServer();
      await benchFileServeRange(server);
    },
  },
  "package.install-minimal": {
    symbol: "kimi.effect.packageInstall",
    thresholdMs: 500,
    skipReason: "set KIMI_PERF_INSTALL=1 on CI to enable install benchmark",
    skipIf: async () => !(installBenchEnabled() && (await installBenchAvailable())),
    workload: async () => {
      await benchMinimalInstall();
    },
  },
  clock: {
    symbol: "kimi.effect.clock",
    thresholdMs: 0.05,
    workload: () => {
      Bun.nanoseconds();
    },
  },
  uuid: {
    symbol: "kimi.effect.uuid",
    thresholdMs: 0.1,
    workload: () => {
      Bun.randomUUIDv7();
    },
  },
};

export function thresholdKeyFor(registryKey: string): string {
  return `kimi.effect.${registryKey}`;
}
