#!/usr/bin/env bun
/** Move shebang to line 1 when migration placed shim import above it. */
import { join } from "path";
const REPO_ROOT = join(import.meta.dir, "..");
const glob = new Bun.Glob("src/**/*.ts");
let fixed = 0;

function fixShebangOrder(text: string): string | null {
  const lines = text.split("\n");
  if (!lines[0]?.startsWith("import ")) return null;
  const shebangIdx = lines.indexOf("#!/usr/bin/env bun");
  if (shebangIdx <= 0) return null;

  const importLine = lines[0]!;
  const rest = lines.slice(1);
  while (rest[0] === "") rest.shift();
  if (rest[0] !== "#!/usr/bin/env bun") return null;

  const next = ["#!/usr/bin/env bun", importLine, ...rest.slice(1)];
  const body = next.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const path = join(REPO_ROOT, rel);
  const text = await Bun.file(path).text();
  const next = fixShebangOrder(text);
  if (!next || next === text) continue;
  await Bun.write(path, next);
  fixed++;
  console.log(`fixed ${rel}`);
}

console.log(`Fixed ${fixed} shebang file(s)`);
