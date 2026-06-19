// ── Extract Methods ────────────────────────────────────────────────

interface MethodDescriptor {
  name: string;
  async: boolean;
  params: string[];
}

export function extractEffectMethods(source: string): MethodDescriptor[] {
  const methods: MethodDescriptor[] = [];

  // export async function name(params)
  const fnRegex = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = fnRegex.exec(source)) !== null) {
    methods.push({
      name: match[1],
      async: true,
      params: match[2]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    });
  }

  // export const name = async (...) =>
  const arrowRegex = /export\s+const\s+(\w+)\s*=\s*async\s*\(([^)]*)\)\s*=>/g;
  while ((match = arrowRegex.exec(source)) !== null) {
    methods.push({
      name: match[1],
      async: true,
      params: match[2]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    });
  }

  // export function name(params) (sync, skip if already captured)
  const syncFnRegex = /export\s+function\s+(\w+)\s*\(([^)]*)\)/g;
  while ((match = syncFnRegex.exec(source)) !== null) {
    if (!methods.some((m) => m.name === match![1])) {
      methods.push({
        name: match[1],
        async: false,
        params: match[2]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      });
    }
  }

  return methods;
}

export async function apiExtractMethods(): Promise<Response> {
  // Scan the dashboard's own source files as a demo
  const files = ["src/index.ts", "src/lib/toolchain-paths.ts"];
  const results: { file: string; methods: MethodDescriptor[] }[] = [];

  for (const f of files) {
    const path = `${import.meta.dir}/../${f}`;
    try {
      const source = await Bun.file(path).text();
      results.push({ file: f, methods: extractEffectMethods(source) });
    } catch {
      results.push({ file: f, methods: [] });
    }
  }

  const exportedFromIndex =
    results
      .find((r) => r.file === "src/index.ts")
      ?.methods.filter(
        (m) =>
          m.name.startsWith("api") || m.name.startsWith("format") || m.name.startsWith("verify")
      ) ?? [];

  return jsonResponse({
    scanned: results,
    summary: `${results.reduce((s, r) => s + r.methods.length, 0)} methods across ${results.length} files`,
    exportedFromIndex: exportedFromIndex.slice(0, 10),
    philosophy:
      "Static analysis before runtime. extractEffectMethods(source) is pure — no globals, no runtime reflection. Bun.Transpiler can parse; regex for lightweight extraction. Same output → same method list.",
  });
}
