// ── Global Store ───────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiGlobalStore(): Promise<Response> {
  // Resolve the global store paths
  const installDir = Bun.env.BUN_INSTALL_GLOBAL_DIR ?? `${Bun.env.HOME}/.bun/install/global`;
  const linksDir = `${installDir}/links`;
  const cacheDir = `${installDir}/cache`;

  // Check what's in the store (non-recursive, just top-level)
  let pkgCount = 0;
  let symlinkExample = "";
  try {
    const pkgs = [...new Bun.Glob("*").scanSync({ cwd: linksDir, onlyFiles: false })];
    pkgCount = pkgs.length;
    if (pkgs.length > 0) {
      // Read a symlink target as example
      const sample = pkgs[0];
      const fullPath = `${linksDir}/${sample}`;
      const stat = await Bun.file(fullPath).exists();
      symlinkExample = `${sample} → exists=${stat}`;
    }
  } catch {
    /* store not yet populated */
  }

  return jsonResponse({
    storePaths: {
      installDir,
      links: linksDir,
      cache: cacheDir,
    },
    state: {
      packages: pkgCount,
      example: symlinkExample || "(store empty — run bun install to populate)",
    },
    philosophy: {
      input: "lockfile + registry state",
      output: "content-addressed, immutable directory tree",
      property: "referentially transparent — same lockfile → same store path",
      warmInstall: "~1 symlink() per package, no clonefileat() kernel locks",
      ciCache: "cache ~/.bun/install/global between CI runs for near-instant warm installs",
    },
    note: "install.globalStore = true in bunfig.toml. Entry hash includes full transitive closure. Two projects with same tree share single on-disk entry — structural sharing, no duplication.",
  });
}
