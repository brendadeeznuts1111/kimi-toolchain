import { SERVICE_ID, SECRET_NAMES, type SecretName } from "./_registry.ts";
import { enforceIsolation } from "./isolation.ts";

async function getSecret(service: string, name: string): Promise<string | undefined> {
  let fromSecrets: string | undefined;
  try {
    const val = await (
      Bun.secrets as { get?: (opts: { service: string; name: string }) => Promise<string | null> }
    )?.get?.({
      service,
      name,
    });
    fromSecrets = val ?? undefined;
  } catch {
    fromSecrets = undefined;
  }
  const envKey = `${service}/${name}`.toUpperCase().replace(/-/g, "_").replace(/\./g, "_");
  return fromSecrets ?? Bun.env[envKey];
}

export const secrets = {
  service: SERVICE_ID,

  async get<N extends SecretName>(name: N): Promise<string | undefined> {
    const key = `${SERVICE_ID}/${name}`;
    enforceIsolation(SERVICE_ID, key);
    return getSecret(SERVICE_ID, name);
  },

  async require<N extends SecretName>(name: N): Promise<string> {
    const val = await this.get(name);
    if (!val) {
      throw new Error(
        `Missing secret: ${SERVICE_ID}/${name}\n` +
          `  Store:   bun secrets set ${SERVICE_ID}/${name} <value>\n` +
          `  Or env:  export ${`${SERVICE_ID}/${name}`.toUpperCase().replace(/-/g, "_").replace(/\./g, "_")}=<value>`
      );
    }
    return val;
  },

  async resolve(): Promise<Record<SecretName, boolean>> {
    const resolved = {} as Record<SecretName, boolean>;
    for (const name of SECRET_NAMES) resolved[name] = !!(await this.get(name));
    return resolved;
  },

  async dryRun(): Promise<void> {
    console.table(
      await Promise.all(
        SECRET_NAMES.map(async (n) => ({
          service: SERVICE_ID,
          name: n,
          key: `${SERVICE_ID}/${n}`,
          status: (await this.get(n)) ? "✅" : "❌",
        }))
      ),
      ["service", "name", "key", "status"]
    );
  },
};
