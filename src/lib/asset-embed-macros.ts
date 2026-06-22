/**
 * asset-embed-macros.ts — Macro functions for embedding binary assets.
 *
 * Reads files as Uint8Array at BUILD TIME. Bun's macro system serializes
 * TypedArrays as base64-encoded strings, so the bundled output contains
 * only the base64 string — no file I/O at runtime.
 *
 * Usage:
 *   import { embedAsset } from "./asset-embed-macros.ts" with { type: "macro" };
 *   const iconBase64 = embedAsset("./src/assets/shield.svg");
 *   // In the bundle: const iconBase64 = "PHN2ZyB4bWxucz0...";
 */

export function embedAsset(path: string): string {
  const file = Bun.file(path);
  if (!file.exists()) {
    throw new Error(`Asset not found: ${path}`);
  }
  // Read synchronously via spawnSync — macros run in Bun's transpiler
  // which awaits any returned Promise. We return a base64 string that
  // Bun can inline as a string literal in the bundle.
  const { stdout } = Bun.spawnSync({
    cmd: ["cat", path],
    stdout: "pipe",
  });
  const bytes = new Uint8Array(stdout);
  return btoa(String.fromCharCode(...bytes));
}
