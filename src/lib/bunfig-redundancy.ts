/**
 * Detect workspace bunfig.toml keys that duplicate machine-level ~/.bunfig.toml install policy.
 * Mirrors projects/scripts/audit-bunfig.sh (precise key-assignment matching).
 */

import { join } from "path";
import { TOML } from "bun";
import { pathExists, pathLstat } from "./bun-io.ts";
import type { BunfigInstallSection } from "./bun-install-types.ts";

export interface BunfigRedundancyHit {
  bunfigPath: string;
  relativePath: string;
  keys: Array<"[install].linker" | "[install].globalStore" | "[install.cache].dir">;
  messages: string[];
}

export interface BunfigRedundancyAudit {
  machineBunfigPath: string | null;
  machineLinker: string | null;
  machineGlobalStore: boolean | null;
  machineCacheDir: string | null;
  hits: BunfigRedundancyHit[];
  ok: boolean;
}

const DEFAULT_PRUNE = ["node_modules", ".bun", "herdr-worktrees", ".git"] as const;

function resolveHome(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): string | null {
  return env.HOME ?? env.USERPROFILE ?? null;
}

function expandTildePath(value: string, home: string | null): string {
  if (!home) return value;
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

/** Same path rule as machine-bun-policy.xdgShadowBunfigPath (no import — avoids a cycle). */
function xdgGlobalBunfigPath(env: Record<string, string | undefined>): string | null {
  const xdg = env.XDG_CONFIG_HOME;
  if (!xdg || xdg.trim().length === 0) return null;
  return join(xdg.replace(/\/+$/, ""), ".bunfig.toml");
}

export type BunfigInode = "missing" | "file" | "symlink" | "dangling-symlink" | "directory";

export type UserBunfigInstallSnapshot = {
  bunfigPath: string | null;
  install: BunfigInstallSection | null;
  cacheDir: string | null;
  inode: BunfigInode;
};

function inspectBunfigInode(path: string): BunfigInode {
  try {
    const st = pathLstat(path);
    if (st.isDirectory()) return "directory";
    if (st.isSymbolicLink()) {
      return pathExists(path) ? "symlink" : "dangling-symlink";
    }
    return "file";
  } catch {
    return "missing";
  }
}

async function readBunfigAt(
  bunfigPath: string,
  home: string | null
): Promise<UserBunfigInstallSnapshot> {
  const inode = inspectBunfigInode(bunfigPath);
  if (inode === "missing" || inode === "directory") {
    return { bunfigPath: null, install: null, cacheDir: null, inode };
  }
  if (inode === "dangling-symlink") {
    return { bunfigPath, install: null, cacheDir: null, inode };
  }

  try {
    const parsed = TOML.parse(await Bun.file(bunfigPath).text()) as {
      install?: BunfigInstallSection;
    };
    const install = parsed.install ?? null;
    const rawDir = install?.cache?.dir ?? null;
    const cacheDir = rawDir ? expandTildePath(rawDir, home) : null;
    return { bunfigPath, install, cacheDir, inode };
  } catch {
    return { bunfigPath, install: null, cacheDir: null, inode };
  }
}

/** Machine SSOT file: `$HOME/.bunfig.toml` only. */
export async function readUserBunfigInstall(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<UserBunfigInstallSnapshot> {
  const home = resolveHome(env);
  if (!home) {
    return { bunfigPath: null, install: null, cacheDir: null, inode: "missing" };
  }
  return readBunfigAt(join(home, ".bunfig.toml"), home);
}

export type UserBunfigLayers = {
  machine: UserBunfigInstallSnapshot;
  effective: UserBunfigInstallSnapshot;
  xdgPath: string | null;
  xdgLoaded: boolean;
};

/**
 * One home read. XDG is inspected only when `XDG_CONFIG_HOME` is set.
 */
export async function readUserBunfigLayers(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<UserBunfigLayers> {
  const machine = await readUserBunfigInstall(env);
  const xdgPath = xdgGlobalBunfigPath(env);
  if (!xdgPath) {
    return { machine, effective: machine, xdgPath: null, xdgLoaded: false };
  }
  const xdg = await readBunfigAt(xdgPath, resolveHome(env));
  const xdgLoaded = xdg.inode === "file" || xdg.inode === "symlink";
  return { machine, effective: xdgLoaded ? xdg : machine, xdgPath, xdgLoaded };
}

/**
 * Global bunfig Bun actually loads: `$XDG_CONFIG_HOME/.bunfig.toml` if present,
 * otherwise `$HOME/.bunfig.toml`.
 */
export async function readEffectiveUserBunfigInstall(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<UserBunfigInstallSnapshot> {
  return (await readUserBunfigLayers(env)).effective;
}

function detectRedundantKeys(
  install: BunfigInstallSection | null,
  machine: BunfigInstallSection | null,
  machineCacheDir: string | null,
  home: string | null
): BunfigRedundancyHit["keys"] {
  if (!install || !machine) return [];

  const keys: BunfigRedundancyHit["keys"] = [];

  if (install.linker != null && machine.linker != null && install.linker === machine.linker) {
    keys.push("[install].linker");
  }

  if (install.globalStore === true && machine.globalStore === true) {
    keys.push("[install].globalStore");
  }

  const projectCacheDir = install.cache?.dir ?? null;
  if (projectCacheDir) {
    const expandedProject = expandTildePath(projectCacheDir, home);
    const isTildeLiteral = projectCacheDir === "~" || projectCacheDir.startsWith("~/");
    const matchesMachine = machineCacheDir != null && expandedProject === machineCacheDir;
    if (isTildeLiteral || matchesMachine) {
      keys.push("[install.cache].dir");
    }
  }

  return keys;
}

async function findWorkspaceBunfigFiles(
  projectRoot: string,
  pruneDirNames: readonly string[] = DEFAULT_PRUNE
): Promise<string[]> {
  const prune = pruneDirNames.map((name) => join(projectRoot, name));
  const findArgs = [
    projectRoot,
    ...prune.flatMap((p) => ["-path", p, "-prune", "-o"]),
    "-name",
    "bunfig.toml",
    "-type",
    "f",
    "-print",
  ];

  const found = Bun.spawnSync(["find", ...findArgs], { stdout: "pipe" });
  if (found.exitCode !== 0) return [];

  return new TextDecoder()
    .decode(found.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function hitMessages(keys: BunfigRedundancyHit["keys"], machinePath: string): string[] {
  return keys.map(
    (key) =>
      `${key} duplicates ${machinePath} — strip from workspace bunfig.toml (inherit machine defaults)`
  );
}

async function auditBunfigPaths(
  projectRoot: string,
  bunfigPaths: string[],
  machine: UserBunfigInstallSnapshot
): Promise<BunfigRedundancyAudit> {
  const home = resolveHome();
  const hits: BunfigRedundancyHit[] = [];

  if (!machine.bunfigPath || !machine.install) {
    return {
      machineBunfigPath: machine.bunfigPath,
      machineLinker: machine.install?.linker ?? null,
      machineGlobalStore: machine.install?.globalStore ?? null,
      machineCacheDir: machine.cacheDir,
      hits: [],
      ok: true,
    };
  }

  for (const bunfigPath of bunfigPaths) {
    try {
      const parsed = TOML.parse(await Bun.file(bunfigPath).text()) as {
        install?: BunfigInstallSection;
      };
      const keys = detectRedundantKeys(
        parsed.install ?? null,
        machine.install,
        machine.cacheDir,
        home
      );
      if (keys.length === 0) continue;

      const relativePath = bunfigPath.startsWith(projectRoot)
        ? bunfigPath.slice(projectRoot.length).replace(/^\//, "")
        : bunfigPath;

      hits.push({
        bunfigPath,
        relativePath,
        keys,
        messages: hitMessages(keys, machine.bunfigPath),
      });
    } catch {
      // skip malformed bunfig
    }
  }

  return {
    machineBunfigPath: machine.bunfigPath,
    machineLinker: machine.install.linker ?? null,
    machineGlobalStore: machine.install.globalStore ?? null,
    machineCacheDir: machine.cacheDir,
    hits,
    ok: hits.length === 0,
  };
}

/** Audit only ./bunfig.toml at project root (kimi-doctor --gate bunfig-policy). */
export async function auditProjectBunfigRedundancy(
  projectRoot: string,
  machine?: UserBunfigInstallSnapshot
): Promise<BunfigRedundancyAudit> {
  const snap = machine ?? (await readEffectiveUserBunfigInstall());
  const bunfigPath = join(projectRoot, "bunfig.toml");
  const paths = pathExists(bunfigPath) ? [bunfigPath] : [];
  return auditBunfigPaths(projectRoot, paths, snap);
}

/** Scan project tree for bunfig.toml files duplicating ~/.bunfig.toml install keys. */
export async function auditWorkspaceBunfigRedundancy(
  projectRoot: string,
  options: { pruneDirNames?: readonly string[]; machine?: UserBunfigInstallSnapshot } = {}
): Promise<BunfigRedundancyAudit> {
  const snap = options.machine ?? (await readEffectiveUserBunfigInstall());
  const bunfigPaths = await findWorkspaceBunfigFiles(
    projectRoot,
    options.pruneDirNames ?? DEFAULT_PRUNE
  );
  return auditBunfigPaths(projectRoot, bunfigPaths, snap);
}
