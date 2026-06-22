/**
 * npm-registry-macros.ts — Async macro for fetching npm package versions.
 *
 * This function is designed to be imported with `with { type: "macro" }`.
 * It makes an HTTP request to the npm registry at BUILD TIME and returns
 * the latest version string. Bun's transpiler awaits the Promise and
 * inlines the result as a static string.
 *
 * Usage:
 *   import { getLatestVersion } from "./npm-registry-macros.ts" with { type: "macro" };
 *   const effectVersion = getLatestVersion("effect");
 *   // In the bundle: const effectVersion = "3.16.0";
 *
 * Note: The argument must be a statically-known string literal.
 */

export async function getLatestVersion(pkg: string): Promise<string> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!response.ok) {
      return "unknown";
    }
    const data = (await response.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function getPackageInfo(pkg: string): Promise<{
  name: string;
  version: string;
  description: string;
}> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!response.ok) {
      return { name: pkg, version: "unknown", description: "" };
    }
    const data = (await response.json()) as {
      name?: string;
      version?: string;
      description?: string;
    };
    return {
      name: data.name ?? pkg,
      version: data.version ?? "unknown",
      description: data.description ?? "",
    };
  } catch {
    return { name: pkg, version: "unknown", description: "" };
  }
}
