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

/** Parse TypeScript into Bun's AST representation. */
export function parse(code: string): ParseResult {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const expression = transpiler.parseSync(code);
  return {
    ok: expression !== undefined && expression !== null,
    expression: String(expression),
    kind: typeof expression,
  };
}

/** Scan TypeScript code for ES module imports/exports. */
export function scanImports(code: string): ImportScanResult[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const imports = transpiler.scan(code);
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
