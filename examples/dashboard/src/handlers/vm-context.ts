// ── VM Context ─────────────────────────────────────────────────────
import { MessageChannel } from "node:worker_threads";
import {
  createIsolation,
  getIsolationCapabilities,
} from "../lib/isolation/index.ts";
import { jsonResponse } from "./shared.ts";

export async function apiVmContext(): Promise<Response> {
  const vm = await import("node:vm");
  const caps = getIsolationCapabilities();
  const requestedMode = Bun.env.KIMI_ISOLATION ?? "realm";
  const isolation = createIsolation(requestedMode);

  const ctx = vm.createContext({ x: 1 });
  vm.runInContext("x = x + 1", ctx);

  const { port1, port2 } = new MessageChannel();
  const messages: string[] = [];
  port2.on("message", (msg) => messages.push(String(msg)));
  port1.postMessage("hello from outer context");
  port2.close();

  let roundtripMs: number | null = null;
  if (isolation.mode === "messageport" && isolation.available) {
    try {
      const channel = isolation.createChannel();
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        channel.hostPort.once("message", (msg: unknown) => {
          if (msg === "pong") resolve();
          else reject(new Error("unexpected roundtrip reply"));
        });
        channel.hostPort.postMessage("ping");
      });
      roundtripMs = performance.now() - start;
      channel.dispose();
    } catch {
      roundtripMs = null;
    }
  }

  const evalResult = await isolation.evaluateScript("1 + 1");

  const moveStatus = caps.messagePort
    ? "success"
    : "not yet implemented (moveMessagePortToContext probe failed)";

  return jsonResponse({
    vmContext: {
      initial: 1,
      afterRunInContext: vm.runInContext("x", ctx),
      verified: vm.runInContext("x", ctx) === 2,
    },
    messageChannel: {
      sent: "hello from outer context",
      received: messages,
    },
    isolationFactory: {
      requestedMode,
      resolvedMode: isolation.mode,
      available: isolation.available,
      evalResult,
      roundtripMs,
      capabilities: caps,
    },
    moveMessagePortToContext: moveStatus,
    isolationStack: {
      shadowRealm: caps.shadowRealm
        ? "✅ Available — evaluate() + importValue()"
        : "❌ unavailable",
      worker: caps.worker ? "✅ Available — new Worker() + postMessage" : "❌ unavailable",
      vmContext: "✅ Available — vm.createContext() + runInContext()",
      movePort: caps.messagePort ? "✅ success" : `❌ ${moveStatus}`,
    },
    note: "Isolation factory (KIMI_ISOLATION) selects worker / realm / messageport. messageport uses moveMessagePortToContext when the runtime probe passes; otherwise falls back to realm.",
  });
}
