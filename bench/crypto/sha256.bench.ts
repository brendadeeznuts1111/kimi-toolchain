import { benchAsync, benchSync } from "../lib/timing.ts";
import { sha256File, sha256String } from "../../src/lib/utils.ts";

const REPO_ROOT = import.meta.dir + "/../..";

export async function runSha256Benchmarks() {
  const pkgPath = REPO_ROOT + "/package.json";
  return [
    {
      label: "sha256String (1KB)",
      sample: benchSync(() => {
        sha256String("x".repeat(1024));
      }, 10_000),
    },
    {
      label: "sha256File (package.json)",
      sample: await benchAsync(async () => {
        await sha256File(pkgPath);
      }, 100),
    },
  ];
}
