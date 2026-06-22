export class SecretIsolationError extends Error {
  readonly code = "SECRET_ISOLATION_VIOLATION";
  constructor(
    readonly caller: string,
    readonly key: string
  ) {
    super(`Isolation breach: ${caller} attempted to access ${key}`);
  }
}

export function enforceIsolation(caller: string, key: string): void {
  const prefix = `${caller}/`;
  if (!key.startsWith(prefix)) {
    throw new SecretIsolationError(caller, key);
  }
}
