/**
 * build-info-macros.ts — Macro functions for embedding build metadata.
 *
 * These functions are designed to be imported with `with { type: "macro" }`.
 * They execute at BUILD TIME and their return values are inlined as static
 * literals in the bundle. Zero runtime overhead.
 *
 * Usage:
 *   import { getGitHash, getGitBranch, getBuildTime, getPackageVersion }
 *     from "./build-info-macros.ts" with { type: "macro" };
 *
 *   const hash = getGitHash();    // becomes "f52d9c0b" in the bundle
 *   const time = getBuildTime();  // becomes "2026-06-21T..." in the bundle
 */

export function getGitHash(): string {
  const { stdout } = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--short", "HEAD"],
    stdout: "pipe",
  });
  return stdout.toString().trim() || "unknown";
}

export function getGitBranch(): string {
  const { stdout } = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    stdout: "pipe",
  });
  return stdout.toString().trim() || "unknown";
}

export function getBuildTime(): string {
  return new Date().toISOString();
}

export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      Bun.spawnSync({
        cmd: ["cat", "package.json"],
        stdout: "pipe",
      }).stdout.toString()
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getBunVersion(): string {
  return Bun.version;
}

export function getPlatform(): string {
  return `${process.platform}-${process.arch}`;
}
