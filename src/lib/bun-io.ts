/**
 * Preferred I/O boundary for call sites — use these names instead of *Sync fs APIs.
 * Implementation may delegate to bun-native-shim until async Bun migration completes.
 */

import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "./bun-native-shim.ts";
import type { Dirent, PathLike, WatchOptions } from "node:fs";
import type { FSWatcher } from "node:fs";

export function pathExists(path: PathLike): boolean {
  return existsSync(path);
}

export function readText(path: PathLike): string {
  return readFileSync(path, "utf8");
}

export function readBytes(path: PathLike): Buffer {
  return readFileSync(path);
}

export function writeText(path: PathLike, data: string, encoding: BufferEncoding = "utf8"): void {
  writeFileSync(path, data, encoding);
}

export function writeBytes(path: PathLike, data: string | Uint8Array): void {
  writeFileSync(path, data);
}

export function appendText(path: PathLike, data: string): void {
  appendFileSync(path, data);
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

export function removeFile(path: PathLike): void {
  unlinkSync(path);
}

export function removePath(path: PathLike, options?: Parameters<typeof rmSync>[1]): void {
  rmSync(path, options);
}

export function pathStat(path: PathLike) {
  return statSync(path);
}

export function pathLstat(path: PathLike) {
  return lstatSync(path);
}

export function copyPath(src: PathLike, dest: PathLike): void {
  copyFileSync(src, dest);
}

export function movePath(oldPath: PathLike, newPath: PathLike): void {
  renameSync(oldPath, newPath);
}

export function readLink(path: PathLike): string {
  return readlinkSync(path);
}

export function copyTree(
  src: PathLike,
  dest: PathLike,
  options?: Parameters<typeof cpSync>[2]
): void {
  cpSync(String(src), String(dest), options);
}

export function resolveRealPath(path: PathLike): string {
  return realpathSync(path);
}

export function watchPath(path: PathLike, listener: () => void): FSWatcher;
export function watchPath(
  path: PathLike,
  options: WatchOptions,
  listener: (...args: unknown[]) => void
): FSWatcher;
export function watchPath(
  path: PathLike,
  optionsOrListener: WatchOptions | (() => void),
  listener?: (...args: unknown[]) => void
): FSWatcher {
  if (typeof optionsOrListener === "function") {
    return watch(path, optionsOrListener);
  }
  return watch(path, optionsOrListener, listener as never);
}

/** Bun-native async read — prefer in new async code. */
export async function readTextAsync(path: string): Promise<string> {
  return Bun.file(path).text();
}

/** Bun-native async write — prefer in new async code. */
export async function writeTextAsync(path: string, data: string): Promise<void> {
  await Bun.write(path, data);
}

/** Bun-native async existence check — prefer in new async code. */
export async function pathExistsAsync(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
