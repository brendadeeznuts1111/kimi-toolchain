/**
 * drift-guard.ts — Bun.secrets API shape validation at boot.
 */

export class SecretsApiDriftError extends Error {
  override readonly name = "SecretsApiDriftError";
}

export function validateSecretsApi(): void {
  const secrets = Bun.secrets;
  if (
    !secrets ||
    typeof secrets.get !== "function" ||
    typeof secrets.set !== "function" ||
    typeof secrets.delete !== "function"
  ) {
    throw new SecretsApiDriftError("Bun.secrets API drift: expected get/set/delete");
  }
}
