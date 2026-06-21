/** Bun-native I/O helpers for scaffolded trading projects. */

export function pathExists(path: string): boolean {
  return Bun.file(path).size !== -1;
}

export function listDir(path: string): string[];
export function listDir(path: string, options: { withFileTypes: true }): import("node:fs").Dirent[];
export function listDir(
  path: string,
  options?: { withFileTypes?: boolean }
): string[] | import("node:fs").Dirent[] {
  const glob = new Bun.Glob("*");
  if (options?.withFileTypes) {
    const entries: import("node:fs").Dirent[] = [];
    for (const name of glob.scanSync({ cwd: path, onlyFiles: false })) {
      const fullPath = `${path}/${name}`;
      const isDir = Bun.file(fullPath).size === -1 && pathExists(fullPath);
      entries.push({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
      } as import("node:fs").Dirent);
    }
    return entries;
  }
  return [...glob.scanSync({ cwd: path, onlyFiles: false })] as string[];
}

async function mkdirBun(path: string, options?: { recursive?: boolean }): Promise<void> {
  const args = options?.recursive ? ["-p", path] : [path];
  const proc = await Bun.spawn(["mkdir", ...args], { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`mkdir failed (exit ${exitCode}): ${path}`);
}

async function rmBun(
  path: string,
  options?: { force?: boolean; recursive?: boolean }
): Promise<void> {
  const args: string[] = [];
  if (options?.recursive) args.push("-r");
  if (options?.force) args.push("-f");
  args.push(path);
  const proc = await Bun.spawn(["rm", ...args], { stdout: "ignore", stderr: "ignore" });
  const exitCode = await proc.exited;
  if (exitCode !== 0 && !options?.force) throw new Error(`rm failed (exit ${exitCode}): ${path}`);
}

export async function makeDir(path: string, options?: { recursive?: boolean }): Promise<void> {
  await mkdirBun(path, options ?? { recursive: true });
}

export async function removePath(
  path: string,
  options?: { force?: boolean; recursive?: boolean }
): Promise<void> {
  await rmBun(path, options ?? { force: true });
}
