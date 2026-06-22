export function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function safeToml<T>(text: string, fallback: T): T {
  try {
    return Bun.TOML.parse(text) as T;
  } catch {
    return fallback;
  }
}
