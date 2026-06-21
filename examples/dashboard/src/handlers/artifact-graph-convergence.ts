import { join } from "path";
import { jsonResponse, resolveRoot } from "./shared.ts";
import { ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION } from "../../../../src/lib/artifact-graph-convergence.ts";

interface ConvergenceSchemaExport {
  name: string;
  kind: "function" | "const" | "type" | "class";
}

interface ConvergenceSchemaPillar {
  id: string;
  name: string;
  modulePath: string;
  exports: ConvergenceSchemaExport[];
}

interface ConvergenceSchemaPayload {
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  convergenceBlockSchemaVersion: typeof ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION;
  pillars: ConvergenceSchemaPillar[];
  totalExports: number;
  pipeline: string[];
  note: string;
}

interface CacheEntry {
  payload: ConvergenceSchemaPayload;
  mtimes: Record<string, number>;
}

const MODULES = [
  {
    id: "convergence",
    name: "Convergence Block",
    file: "src/lib/artifact-graph-convergence.ts",
  },
  {
    id: "context",
    name: "Context & Health",
    file: "src/lib/artifact-graph-health.ts",
  },
  {
    id: "runtime",
    name: "Runtime Capabilities",
    file: "src/lib/bun-install-config.ts",
  },
] as const;

let cache: CacheEntry | null = null;

const transpiler = new Bun.Transpiler({ loader: "ts" });

function classifyExport(name: string, source: string): ConvergenceSchemaExport["kind"] {
  const patterns: Array<[ConvergenceSchemaExport["kind"], RegExp]> = [
    ["function", new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`)],
    ["class", new RegExp(`\\bexport\\s+class\\s+${name}\\b`)],
    ["const", new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${name}\\b`)],
    ["type", new RegExp(`\\bexport\\s+(?:type|interface|enum)\\s+${name}\\b`)],
  ];
  for (const [kind, re] of patterns) {
    if (re.test(source)) return kind;
  }
  return "const";
}

async function getCachedSchema(): Promise<ConvergenceSchemaPayload> {
  const root = resolveRoot();
  const currentMtimes: Record<string, number> = {};
  const moduleData: Array<{ module: (typeof MODULES)[number]; source: string; absPath: string }> =
    [];

  for (const m of MODULES) {
    const absPath = join(root, m.file);
    const stat = await Bun.file(absPath).stat();
    currentMtimes[absPath] = stat.mtimeMs;
    const source = await Bun.file(absPath).text();
    moduleData.push({ module: m, source, absPath });
  }

  if (
    cache &&
    MODULES.every((m) => {
      const absPath = join(root, m.file);
      return cache!.mtimes[absPath] === currentMtimes[absPath];
    })
  ) {
    return cache.payload;
  }

  const pillars: ConvergenceSchemaPillar[] = moduleData.map(({ module, source }) => {
    const scan = transpiler.scan(source);
    const exports: ConvergenceSchemaExport[] = scan.exports.map((name) => ({
      name,
      kind: classifyExport(name, source),
    }));
    return {
      id: module.id,
      name: module.name,
      modulePath: module.file,
      exports,
    };
  });

  const totalExports = pillars.reduce((sum, p) => sum + p.exports.length, 0);

  const payload: ConvergenceSchemaPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: true,
    convergenceBlockSchemaVersion: ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION,
    pillars,
    totalExports,
    pipeline: [
      "Bun.Transpiler({ loader: 'ts' })",
      ".scan(source) → { exports: string[], imports: [...] }",
      "classifyExport() → kind (function | const | type | class)",
      "mtime-keyed cache — re-scans only when source files change",
    ],
    note: "Transpiler.scan() discovers exported names without executing code. New exports in convergence modules automatically appear in the schema panel on refresh.",
  };

  cache = { payload, mtimes: currentMtimes };
  return payload;
}

export async function apiArtifactGraphConvergenceSchema(): Promise<Response> {
  try {
    const payload = await getCachedSchema();
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        ok: false,
        convergenceBlockSchemaVersion: ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION,
        pillars: [],
        totalExports: 0,
        pipeline: [],
        note: `Schema generation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500
    );
  }
}
