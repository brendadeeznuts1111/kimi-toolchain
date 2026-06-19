import { createMessagePortIsolation } from "./messageport.ts";

export function benchmarkMessagePortCreateChannel(): number {
  const start = performance.now();
  const iso = createMessagePortIsolation();
  const ch = iso.createChannel();
  ch.dispose();
  return performance.now() - start;
}

export async function benchmarkMessagePortRoundtrip(): Promise<number> {
  const iso = createMessagePortIsolation();
  const ch = iso.createChannel();
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    ch.hostPort.once("message", (msg) => {
      if (msg === "pong") resolve();
      else reject(new Error("unexpected roundtrip"));
    });
    ch.hostPort.postMessage("ping");
  });
  ch.dispose();
  return performance.now() - start;
}
