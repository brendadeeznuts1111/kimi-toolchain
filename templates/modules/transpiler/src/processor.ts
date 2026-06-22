// templates/modules/transpiler/src/processor.ts
// Bun.Transpiler API — registered via registerEffect("transpiler") in init.ts

export interface ParseResult {
  ok: boolean;
  expression: string;
  kind: string;
}

export interface ImportScanResult {
  path: string;
  kind: string;
}

/** Parse TypeScript by transforming to JS (Bun.Transpiler has no parseSync). */
export function parse(code: string): ParseResult {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  try {
    const expression = transpiler.transformSync(code);
    return {
      ok: expression.length > 0,
      expression: expression.slice(0, 120),
      kind: "transformed",
    };
  } catch (error) {
    return {
      ok: false,
      expression: error instanceof Error ? error.message : String(error),
      kind: "error",
    };
  }
}

/** Scan TypeScript code for ES module imports/exports. */
export function scanImports(code: string): ImportScanResult[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const scanned = transpiler.scan(code) as { imports?: Array<{ path: string; kind: string }> };
  const imports = scanned.imports ?? [];
  return imports.map((entry) => ({ path: entry.path, kind: entry.kind }));
}

/** Transform TypeScript/TSX to JavaScript. */
export function transform(code: string, loader: "ts" | "tsx" | "js" = "ts"): string {
  const transpiler = new Bun.Transpiler({ loader });
  return transpiler.transformSync(code);
}

/** Strip TypeScript types and return runnable JS. */
export function stripTypes(code: string): string {
  return transform(code, "ts");
}