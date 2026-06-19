import { isMessagePortIsolationAvailable } from "./probe.ts";
import { createMessagePortIsolation } from "./messageport.ts";
import { createRealmIsolation } from "./realm.ts";
import { createWorkerIsolation } from "./worker.ts";
import type { IsolationEffect, IsolationMode } from "./types.ts";

export function createIsolation(mode?: string): IsolationEffect {
  const resolved: IsolationMode = (mode || Bun.env.KIMI_ISOLATION || "realm") as IsolationMode;

  if (resolved === "messageport") {
    if (isMessagePortIsolationAvailable()) {
      return createMessagePortIsolation();
    }
    console.warn("messageport isolation not available, falling back to realm");
    return { ...createRealmIsolation(), available: false };
  }

  if (resolved === "worker") return createWorkerIsolation();
  return createRealmIsolation();
}

export type { IsolationEffect, IsolationChannel, IsolationMode } from "./types.ts";
export { isMessagePortIsolationAvailable, resetMessagePortProbeCache } from "./probe.ts";
