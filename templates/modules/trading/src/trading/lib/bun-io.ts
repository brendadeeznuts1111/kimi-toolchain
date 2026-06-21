/** Minimal Bun-native fs helpers for scaffolded trading projects. */

export interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export type PathLike = string;

export function pathExists(path: PathLike): boolean {
  return Bun.file(path).size !== 0 || require("node:fs").existsSync(path);
}

/**
 * List directory contents using Bun.Glob (Bun-native, no node:fs import).
 * Returns filenames only (no leading `./`).
 */
export function listDir(path: PathLike): string[];
export function listDir(path: PathLike, options: { withFileTypes: true }): Dirent[];
export function listDir(
  path: PathLike,
  options?: { withFileTypes?: boolean }
): string[] | Dirent[] {
  const glob = new Bun.Glob("*");
  const names = [...glob.scanSync({ cwd: String(path), onlyFiles: false })].sort();
  if (options?.withFileTypes) {
    return names.map((name) => ({
      name,
      isDirectory: () =>
        !Bun.file(`${String(path)}/${name}`).size &&
        require("node:fs")
          .statSync(`${String(path)}/${name}`)
          .isDirectory(),
      isFile: () => Bun.file(`${String(path)}/${name}`).size > 0,
    }));
  }
  return names;
}

/** Create directory using Bun.spawn (Bun-native shell). */
export function makeDir(path: PathLike, options?: { recursive?: boolean }): void {
  const args = options?.recursive ? ["mkdir", "-p", String(path)] : ["mkdir", String(path)];
  Bun.spawnSync(args);
}

/** Remove path using Bun.spawn (Bun-native shell). */
export function removePath(
  path: PathLike,
  options?: { force?: boolean; recursive?: boolean }
): void {
  const args = ["rm"];
  if (options?.force) args.push("-f");
  if (options?.recursive) args.push("-r");
  args.push(String(path));
  Bun.spawnSync(args);
}
