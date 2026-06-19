import type { IsolationChannel, IsolationEffect } from "./types.ts";

export function createRealmIsolation(): IsolationEffect {
  const ShadowRealmCtor = (globalThis as { ShadowRealm?: typeof ShadowRealm }).ShadowRealm;
  if (!ShadowRealmCtor) {
    throw new Error("ShadowRealm not available");
  }

  return {
    mode: "realm",
    available: true,

    async run<T>(fn: () => T | Promise<T>): Promise<T> {
      const realm = new ShadowRealmCtor();
      return realm.evaluate(`(${fn.toString()})()`);
    },

    async evaluateScript(code: string, globals?: Record<string, unknown>): Promise<unknown> {
      const realm = new ShadowRealmCtor();
      if (globals) {
        for (const [k, v] of Object.entries(globals)) {
          realm.evaluate(`globalThis.${k} = ${JSON.stringify(v)}`);
        }
      }
      return realm.evaluate(code);
    },

    createChannel(): IsolationChannel {
      throw new Error("ShadowRealm does not support MessageChannel transfer");
    },
  };
}
