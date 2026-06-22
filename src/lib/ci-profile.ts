/**
 * CI profiling helpers — locate Bun --cpu-prof artifacts in CWD.
 */
import { join } from "path";

/** Newest `*.cpuprofile` in `dir` (default CWD), or null. */
export function findCpuProfile(dir = "."): string | null {
  const glob = new Bun.Glob("*.cpuprofile");
  const files = [...glob.scanSync({ cwd: dir, onlyFiles: true, absolute: true })];
  if (files.length === 0) return null;
  return files.sort().at(-1) ?? null;
}

/** Resolve artifact path under `.kimi-artifacts/profiles/`. */
export function cpuProfileArtifactPath(root: string, profilePath: string): string {
  const name = profilePath.split("/").pop() ?? "profile.cpuprofile";
  return join(root, ".kimi-artifacts", "profiles", name);
}
