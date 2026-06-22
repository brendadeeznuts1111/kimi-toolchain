/**
 * Bun Docs MCP — dashboard API for probe card and live search.
 *
 * GET  /api/bun-docs        — tool list, stability, MCP probe metadata
 * POST /api/bun-docs/search — JSON-RPC tools/call via mcp/sse client
 */

import {
  buildBunDocsKnowledgeCard,
  formatBunDocsContent,
  queryBunDocsFilesystem,
  searchBunDocs,
} from "../../../../src/lib/bun-docs-mcp.ts";
import { BUN_DOCS_MCP_TOOLS } from "../../../../src/lib/mcp-registry.ts";
import { jsonErrorResponse, jsonResponse } from "./shared.ts";

const SEARCH_TOOLS = new Set<string>(BUN_DOCS_MCP_TOOLS);
const BUN_DOCS_DOMAIN = "com.kimi.toolchain.dashboard.bun-docs";

interface ReadableBody {
  text(): Promise<string>;
}

function asReadable(req: Request): ReadableBody {
  return req as unknown as ReadableBody;
}

async function readJson<T>(req: ReadableBody): Promise<T | null> {
  try {
    const raw = await req.text();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function apiBunDocs(): Promise<Response> {
  const card = await buildBunDocsKnowledgeCard();
  return jsonResponse({
    ...card,
    commands: [
      "kimi-mcp bun-docs",
      'kimi-mcp bun-docs "Bun.escapeHTML"',
      "kimi-doctor --bun-docs <query> --json",
    ],
    fetchedAt: new Date().toISOString(),
  });
}

export async function apiBunDocsSearch(req: Request): Promise<Response> {
  const body = await readJson<{ query?: string; command?: string; tool?: string }>(asReadable(req));
  if (!body) {
    return jsonErrorResponse(
      {
        domain: BUN_DOCS_DOMAIN,
        taxonomyId: "dashboard_invalid_json",
        message: "request body must be JSON",
      },
      400
    );
  }

  const tool = body.tool?.trim() || "search_bun";
  const query = body.query?.trim();
  const command = body.command?.trim() ?? query;

  if (tool === "query_docs_filesystem_bun") {
    if (!command) {
      return jsonErrorResponse(
        {
          domain: BUN_DOCS_DOMAIN,
          taxonomyId: "dashboard_missing_command",
          message: "command is required for query_docs_filesystem_bun",
        },
        400
      );
    }
  } else if (!query) {
    return jsonErrorResponse(
      {
        domain: BUN_DOCS_DOMAIN,
        taxonomyId: "dashboard_missing_query",
        message: "query is required",
      },
      400
    );
  }

  if (!SEARCH_TOOLS.has(tool)) {
    return jsonErrorResponse(
      {
        domain: BUN_DOCS_DOMAIN,
        taxonomyId: "dashboard_invalid_tool",
        message: `tool must be one of: ${[...SEARCH_TOOLS].join(", ")}`,
      },
      400
    );
  }

  const result =
    tool === "query_docs_filesystem_bun"
      ? await queryBunDocsFilesystem(command!)
      : await searchBunDocs(query!);

  return jsonResponse({
    ok: result.ok,
    tool,
    query: tool === "query_docs_filesystem_bun" ? command : query,
    text: result.ok ? formatBunDocsContent(result.content) : undefined,
    content: result.content,
    error: result.error,
    latencyMs: result.latencyMs,
    cached: result.cached ?? false,
    attempts: result.attempts,
    fetchedAt: new Date().toISOString(),
  });
}
