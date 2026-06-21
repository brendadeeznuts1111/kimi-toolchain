/** Minimal Bun/Node fs helpers for scaffolded trading projects. */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import type { Dirent, PathLike } from "node:fs";

export function pathExists(path: PathLike): boolean {
  return existsSync(path);
}

export function listDir(path: PathLike): string[];
export function listDir(path: PathLike, options: { withFileTypes: true }): Dirent[];
export function listDir(
  path: PathLike,
  options?: { withFileTypes?: boolean }
): string[] | Dirent[] {
  if (options?.withFileTypes) {
    return readdirSync(path, { withFileTypes: true });
  }
  return readdirSync(path) as string[];
}

export function makeDir(path: PathLike, options?: { recursive?: boolean }): void {
  mkdirSync(path, options);
}

export function removePath(path: PathLike, options?: Parameters<typeof rmSync>[1]): void {
  rmSync(path, options);
}
