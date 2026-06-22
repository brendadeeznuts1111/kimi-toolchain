import { secrets } from "./access.ts";

export async function resolveDevSecrets(): Promise<Record<string, boolean>> {
  return secrets.resolve();
}
