// ── Transpiler ─────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiTranspiler(): Promise<Response> {
  const tsCode = `import { serve } from "bun";

interface User {
  name: string;
  age: number;
}

const greet = (u: User): string => {
  return \`Hello, \${u.name} (\${u.age})\`;
};

serve({
  fetch(req: Request): Response {
    const u: User = { name: "Bun", age: 3 };
    return new Response(greet(u));
  } });`;

  const t = new Bun.Transpiler({ loader: "ts" });
  const js = t.transformSync(tsCode);

  return jsonResponse({
    inputLines: tsCode.split("\n").length,
    inputBytes: tsCode.length,
    outputBytes: js.length,
    ratio: (js.length / tsCode.length).toFixed(2),
    output: js.slice(0, 400) + (js.length > 400 ? "\n// ..." : ""),
    features: [
      "type annotations stripped",
      "interfaces removed",
      "return types removed",
      "parameter types removed",
    ],
    note: "Bun.Transpiler — fast TS/JSX → JS. loader: 'ts'|'tsx'|'jsx'. transformSync() or transform() for async.",
  });
}
