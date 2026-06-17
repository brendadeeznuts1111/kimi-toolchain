#!/usr/bin/env bun
/** Restore shebang-first order after migrate-bun-native-imports prepends imports. */
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const glob = new Bun.Glob("src/**/*.ts");
let fixed = 0;

for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const path = join(REPO_ROOT, rel);
  const lines = (await Bun.file(path).text()).split("\n");
  if (!lines[0]?.startsWith("import ") || lines[1] !== "#!/usr/bin/env bun") continue;
  const importLine = lines[0];
  const next = ["#!/usr/bin/env bun", importLine, ...lines.slice(2)].join("\n");
  await Bun.write(path, next.endsWith("\n") ? next : `${next}\n`);
  fixed++;
}

console.log(`Fixed ${fixed} shebang file(s)`);
