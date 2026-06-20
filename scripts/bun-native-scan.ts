#!/usr/bin/env bun
import { Glob } from "bun";

const nodeImport = (module: string): RegExp =>
  new RegExp(`import\\s+(?:\\{[^}]*\\}|\\w+)\\s+from\\s*['"]node:${module}['"]`);

const TARGETS = [
  { name: "node:crypto", pattern: nodeImport("crypto") },
  { name: "node:os", pattern: nodeImport("os") },
  { name: "node:https", pattern: nodeImport("https") },
  { name: "Buffer", pattern: /Buffer\.(from|alloc|allocUnsafe|byteLength)/ },
  { name: "fs-sync", pattern: /fs\.(readFileSync|writeFileSync|existsSync)/ },
];

const results: Record<string, { file: string; line: number; code: string }[]> = {};
for (const t of TARGETS) results[t.name] = [];

const g = new Glob("**/*.{ts,js,mjs}");
for await (const f of g.scan({ cwd: ".", absolute: false })) {
  if (f.includes("node_modules") || f.includes("dist/") || f.includes("build/") || f.endsWith(".d.ts")) continue;
  const text = await Bun.file(f).text();
  const lines = text.split("\n");
  for (const t of TARGETS) {
    lines.forEach((line, i) => {
      if (t.pattern.test(line)) results[t.name].push({ file: f, line: i + 1, code: line.trim() });
    });
  }
}

console.log(JSON.stringify(results, null, 2));