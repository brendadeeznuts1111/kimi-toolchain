import { MessageChannel, moveMessagePortToContext } from "node:worker_threads";
import { createContext } from "node:vm";

let cached: boolean | null = null;

export function isMessagePortIsolationAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const { port1, port2 } = new MessageChannel();
    const ctx = createContext({});
    moveMessagePortToContext(port2, ctx);
    port1.close();
    cached = true;
    return true;
  } catch {
    cached = false;
    return false;
  }
}

/** Test-only: clear cached probe result. */
export function resetMessagePortProbeCache(): void {
  cached = null;
}
