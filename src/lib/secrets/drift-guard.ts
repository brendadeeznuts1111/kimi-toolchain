/**
 * drift-guard.ts — Bun.secrets API shape validation at boot.
 */

export class SecretsAPIDriftError extends Error {
  override readonly name = "SecretsAPIDriftError";
}

export function validateSecretsAPI(): void {
  const secrets = Bun.secrets;
  if (
    !secrets ||
    typeof secrets.get !== "function" ||
    typeof secrets.set !== "function" ||
    typeof secrets.delete !== "function"
  ) {
    throw new SecretsAPIDriftError("Bun.secrets API drift: expected get/set/delete");
  }
}
