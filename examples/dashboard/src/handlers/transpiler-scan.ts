// ── Transpiler Scan ────────────────────────────────────────────────

interface EffectMethod {
  file: string;
  exports: string[];
  importCount: number;
}

export async function apiTranspilerScan(): Promise<Response> {
  // Scan dashboard's own source files
  const files = ["src/index.ts", "src/lib/toolchain-paths.ts"];
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const results: EffectMethod[] = [];

  for (const f of files) {
    const path = `${import.meta.dir}/../${f}`;
    try {
      const source = await Bun.file(path).text();
      const scan = transpiler.scan(source);
      results.push({ file: f, exports: scan.exports, importCount: scan.imports.length });
    } catch {
      results.push({ file: f, exports: [], importCount: 0 });
    }
  }

  const totalExports = results.reduce((s, r) => s + r.exports.length, 0);

  return jsonResponse({
    results,
    totalExports,
    pipeline: [
      "Bun.Transpiler({ loader: 'ts' })",
      ".scan(source) → { exports: string[], imports: [...] }",
      "No execution — pure static analysis",
      "~10ms for entire effect directory",
      "Feeds into perf-monitor: know what to measure before calling",
    ],
    note: "Bun.Transpiler.scan() discovers exported names without executing code. Pure function, same source → same exports. Use for static manifests, auto-registration, CI gating.",
  });
}
