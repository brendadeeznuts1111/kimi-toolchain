/** Bun-native I/O helpers for scaffolded trading projects. */

type PathLike = string;

export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function toPath(path: PathLike): string {
  return String(path);
}

function isDirectory(path: string): boolean {
  return Bun.spawnSync({ cmd: ["test", "-d", path] }).exitCode === 0;
}

/** Sync existence check — file or directory (Bun.file().size is 0 for missing paths). */
export function pathExists(path: PathLike): boolean {
  const target = toPath(path);
  return Bun.spawnSync({ cmd: ["test", "-e", target] }).exitCode === 0;
}

export function listDir(path: PathLike): string[];
export function listDir(path: PathLike, options: { withFileTypes: true }): DirEntry[];
export function listDir(
  path: PathLike,
  options?: { withFileTypes?: boolean }
): string[] | DirEntry[] {
  const dir = toPath(path);
  const names = [...new Bun.Glob("*").scanSync({ cwd: dir, onlyFiles: false })];
  if (options?.withFileTypes) {
    return names.map((name) => {
      const full = `${dir}/${name}`;
      const directory = isDirectory(full);
      return {
        name,
        isDirectory: () => directory,
        isFile: () => !directory,
      };
    });
  }
  return names;
}

export function makeDir(path: PathLike, options?: { recursive?: boolean }): void {
  const target = toPath(path);
  const cmd = options?.recursive ? ["mkdir", "-p", target] : ["mkdir", target];
  Bun.spawnSync({ cmd });
}

export function removePath(
  path: PathLike,
  options?: { force?: boolean; recursive?: boolean }
): void {
  const target = toPath(path);
  const cmd = ["rm"];
  if (options?.force) cmd.push("-f");
  if (options?.recursive) cmd.push("-r");
  cmd.push(target);
  Bun.spawnSync({ cmd });
}
