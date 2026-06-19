import { createIsolation } from "./factory.ts";
import { isMessagePortIsolationAvailable } from "./probe.ts";
import { benchmarkWorkerCreateChannel, benchmarkWorkerRoundtrip } from "./worker-bench.ts";
import {
  benchmarkMessagePortCreateChannel,
  benchmarkMessagePortRoundtrip,
} from "./messageport-bench.ts";
import { benchmarkRealmEvaluate } from "./realm-bench.ts";

export type { IsolationEffect, IsolationChannel, IsolationMode } from "./types.ts";
export {
  createIsolation,
  isMessagePortIsolationAvailable,
  resetMessagePortProbeCache,
} from "./factory.ts";

export interface PerfWorkloadEntry {
  symbol: string;
  thresholdMs: number;
  workload: () => Promise<void> | void;
}

export function getIsolationCapabilities() {
  return {
    shadowRealm: typeof (globalThis as { ShadowRealm?: unknown }).ShadowRealm === "function",
    worker: typeof Worker !== "undefined",
    messagePort: isMessagePortIsolationAvailable(),
    resolvedEnv: Bun.env.KIMI_ISOLATION ?? "realm",
  };
}

/** PERF_REGISTRY / MODULE_REGISTRY isolation workloads. */
export const ISOLATION_PERF_WORKLOADS: Record<string, PerfWorkloadEntry> = {
  "isolation.realmEvaluate": {
    symbol: "kimi.effect.isolation",
    thresholdMs: 5,
    workload: () => {
      benchmarkRealmEvaluate();
    },
  },
  "isolation.createChannel": {
    symbol: "kimi.effect.isolation",
    thresholdMs: 50,
    workload: async () => {
      if (isMessagePortIsolationAvailable()) {
        benchmarkMessagePortCreateChannel();
        return;
      }
      benchmarkWorkerCreateChannel();
    },
  },
  "isolation.roundtrip": {
    symbol: "kimi.effect.isolation",
    thresholdMs: 100,
    workload: async () => {
      if (isMessagePortIsolationAvailable()) {
        await benchmarkMessagePortRoundtrip();
        return;
      }
      await benchmarkWorkerRoundtrip();
    },
  },
  "isolation.realm.run": {
    symbol: "kimi.effect.isolation",
    thresholdMs: 10,
    workload: async () => {
      const iso = createIsolation("realm");
      const result = await iso.run(() => 42);
      if (result !== 42) throw new Error(`Expected 42, got ${result}`);
    },
  },
  "isolation.worker.run": {
    symbol: "kimi.effect.isolation",
    thresholdMs: 100,
    workload: async () => {
      const iso = createIsolation("worker");
      const result = await iso.run(() => 21);
      if (result !== 21) throw new Error(`Expected 21, got ${result}`);
    },
  },
};
