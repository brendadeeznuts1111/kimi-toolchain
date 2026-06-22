/**
 * Scaffold slim I/O boundary — sync fs confined here; call sites use named helpers.
 * @bun-native-exempt — intentional sync boundary for scaffold scripts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { PathLike } from "node:fs";

export function pathExists(path: PathLike): boolean {
  return existsSync(path);
}

export function readText(path: PathLike): string {
  return readFileSync(path, "utf8");
}

export function writeText(path: PathLike, data: string): void {
  writeFileSync(path, data, "utf8");
}

export function makeDir(path: PathLike, options?: { recursive?: boolean }): void {
  mkdirSync(path, options);
}
