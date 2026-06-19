// ── Glob Orphan ────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiGlobOrphan(): Promise<Response> {
  const { Glob } = await import("bun");

  // Scan repo for test files and snapshot files
  const snapPattern = "**/__snapshots__/*.snap";
  const testPattern = "**/*.test.ts";
  const snaps = [...new Glob(snapPattern).scanSync({ cwd: process.cwd() })];
  const tests = [...new Glob(testPattern).scanSync({ cwd: process.cwd() })];

  const orphans: string[] = [];
  for (const s of snaps) {
    // Remove __snapshots__/<name>.snap → derive expected test file base
    // Regex handles nested dirs: src/a/__snapshots__/foo.snap → src/a/foo
    const base = s.replace(/__snapshots__\/(.+)\.snap$/, "$1");
    const expectedTest = base + ".test.ts";
    if (!tests.some((t) => t === expectedTest || t.endsWith("/" + expectedTest))) {
      orphans.push(s);
    }
  }

  return jsonResponse({
    patterns: { snapshots: snapPattern, tests: testPattern },
    counts: { snapshots: snaps.length, tests: tests.length, orphans: orphans.length },
    orphans: orphans.slice(0, 10),
    // Per-package scan (monorepo style)
    perPackage: (() => {
      const pkgs = [...new Glob("packages/*").scanSync({ cwd: process.cwd(), onlyFiles: false })];
      return pkgs.slice(0, 3).map((pkg) => {
        const pkgSnaps = [
          ...new Glob(`${pkg}/**/__snapshots__/**/*.snap`).scanSync({ cwd: process.cwd() }),
        ];
        return { package: pkg, snapshots: pkgSnaps.length };
      });
    })(),
    oneLiner:
      "bun -e '\n" +
      'const { Glob } = require("bun");\n' +
      'const snaps = [...new Glob("**/__snapshots__/*.snap").scanSync()];\n' +
      'const tests = [...new Glob("**/*.test.ts").scanSync()];\n' +
      "for (const s of snaps) {\n" +
      '  const base = s.replace(/__snapshots__\\/(.+)\\.snap$/, "$1");\n' +
      '  const expected = base + ".test.ts";\n' +
      '  if (!tests.some(t => t === expected || t.endsWith("/" + expected)))\n' +
      '    console.log("ORPHAN:", s);\n' +
      "}'\n" +
      "// Monorepo per-package variant:\n" +
      '// const packages = [...new Glob("packages/*").scanSync()];\n' +
      "// for (const pkg of packages) {\n" +
      "//   const snaps = [...new Glob(`${pkg}/**/__snapshots__/**/*.snap`).scanSync()];\n" +
      "//   ...",
    note: "Autophagy scan: Bun.Glob.scanSync() cross-references __snapshots__ against test files. Regex handles nested dirs. Per-package variant for monorepos. Live-recomputed every request — no cached badges.",
  });
}
