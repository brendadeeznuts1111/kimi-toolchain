import { describe, expect, test } from "bun:test";
import {
  domainService,
  deleteSecret,
  getSecret,
  setSecret,
  FACTORY_WAGER_SERVICE_PREFIX,
} from "../src/lib/secrets.ts";
import type { SecretsBackend } from "../src/lib/secrets-types.ts";

function mockBackend(store: Map<string, string>): SecretsBackend {
  return {
    async get({ service, name }) {
      return store.get(`${service}:${name}`) ?? null;
    },
    async set({ service, name, value }) {
      store.set(`${service}:${name}`, value);
    },
    async delete({ service, name }) {
      const key = `${service}:${name}`;
      if (!store.has(key)) return false;
      store.delete(key);
      return true;
    },
  };
}

describe("secrets-domain", () => {
  test("domainService uses factory-wager prefix", () => {
    expect(domainService("sportsbook")).toBe(`${FACTORY_WAGER_SERVICE_PREFIX}.sportsbook`);
    expect(domainService("payments")).toBe(`${FACTORY_WAGER_SERVICE_PREFIX}.payments`);
  });

  test("getSecret reads backend then env fallback", async () => {
    const store = new Map<string, string>();
    const backend = mockBackend(store);
    await setSecret("sportsbook", "buckeye-api-key", "from-store", { backend });

    const fromStore = await getSecret("sportsbook", "buckeye-api-key", { backend, env: {} });
    expect(fromStore).toBe("from-store");

    const fromEnv = await getSecret("alerts", "discord-webhook", {
      backend: mockBackend(new Map()),
      env: {
        COM_FACTORY_WAGER_ALERTS_DISCORD_WEBHOOK: "https://discord.example/hook",
      },
    });
    expect(fromEnv).toBe("https://discord.example/hook");
  });

  test("deleteSecret removes stored value", async () => {
    const store = new Map<string, string>();
    const backend = mockBackend(store);
    await setSecret("payments", "stripe-live-key", "sk_live_test", { backend });
    expect(await deleteSecret("payments", "stripe-live-key", { backend })).toBe(true);
    expect(await getSecret("payments", "stripe-live-key", { backend, env: {} })).toBeNull();
  });
});
