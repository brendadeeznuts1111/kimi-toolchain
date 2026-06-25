/**
 * Preferred I/O boundary for call sites — use these names instead of *Sync fs APIs.
 * Sync I/O boundary — async reads/writes use Bun.file/Bun.write at call sites.
 */

import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
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

export function readLink(path: PathLike): string {
  return readlinkSync(path, "utf8");
}

export function movePath(oldPath: PathLike, newPath: PathLike): void {
  renameSync(oldPath, newPath);
}

export function copyTree(
  src: PathLike,
  dest: PathLike,
  options?: Parameters<typeof cpSync>[2]
): void {
  cpSync(String(src), String(dest), options);
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

export type JsonValidator<T> = (value: unknown) => value is T;

/** Validate parsed JSON with a type guard; throws on mismatch. */
export function parseJsonValue<T>(raw: unknown, validate: JsonValidator<T>, label = "JSON"): T {
  if (!validate(raw)) {
    throw new Error(`Invalid ${label}`);
  }
  return raw;
}

/** Read JSON file and validate; throws on parse or validation failure. */
export async function readJsonValidated<T>(path: string, validate: JsonValidator<T>): Promise<T> {
  const raw = await Bun.file(path).json();
  return parseJsonValue(raw, validate, path);
}

/** Read JSON with validation; returns fallback when missing, unparseable, or invalid. */
export async function readJsonFileOr<T>(
  path: string,
  fallback: T,
  validate: JsonValidator<T>
): Promise<T> {
  if (!pathExists(path)) return fallback;
  try {
    const raw = await Bun.file(path).json();
    return validate(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

/** Read and validate JSON; returns null when missing, unparseable, or invalid. */
export async function tryReadJsonValidated<T>(
  path: string,
  validate: JsonValidator<T>
): Promise<T | null> {
  if (!pathExists(path)) return null;
  try {
    const raw = await Bun.file(path).json();
    return validate(raw) ? raw : null;
  } catch {
    return null;
  }
}
