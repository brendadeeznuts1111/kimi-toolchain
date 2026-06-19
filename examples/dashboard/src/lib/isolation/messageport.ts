import { MessageChannel, moveMessagePortToContext } from "node:worker_threads";
import { createContext, runInContext } from "node:vm";
import type { IsolationChannel, IsolationEffect } from "./types.ts";

const SANDBOX_RECEIVER = `
port.on("message", (msg) => {
  if (msg === "ping") {
    port.postMessage("pong");
    return;
  }
  if (msg && msg.type === "eval") {
    try {
      if (msg.globals) {
        for (const [key, value] of Object.entries(msg.globals)) {
          globalThis[key] = value;
        }
      }
      const result = eval(msg.code);
      if (result && typeof result.then === "function") {
        result.then(
          (value) => port.postMessage({ ok: true, result: value }),
          (err) => port.postMessage({ ok: false, error: String(err) })
        );
      } else {
        port.postMessage({ ok: true, result });
      }
    } catch (err) {
      port.postMessage({ ok: false, error: String(err) });
    }
  }
});
`;

export function createMessagePortIsolation(): IsolationEffect {
  return {
    mode: "messageport",
    available: true,

    async run<T>(fn: () => T | Promise<T>): Promise<T> {
      return this.evaluateScript(`(${fn.toString()})()`) as Promise<T>;
    },

    async evaluateScript(code: string, globals?: Record<string, unknown>): Promise<unknown> {
      const { hostPort, dispose } = this.createChannel();
      try {
        return await new Promise((resolve, reject) => {
          hostPort.once("message", (msg: { ok?: boolean; result?: unknown; error?: string }) => {
            if (msg.ok) resolve(msg.result);
            else reject(new Error(msg.error ?? "eval failed"));
          });
          hostPort.postMessage({ type: "eval", code, globals });
        });
      } finally {
        dispose();
      }
    },

    createChannel(): IsolationChannel {
      const { port1, port2 } = new MessageChannel();
      const context = createContext({});
      moveMessagePortToContext(port2, context);
      runInContext(SANDBOX_RECEIVER, context);

      return {
        hostPort: port1,
        dispose() {
          port1.close();
        },
        [Symbol.dispose]() {
          port1.close();
        },
      };
    },
  };
}
