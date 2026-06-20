// ── Trace Verify ───────────────────────────────────────────────────
import { decodeHex, encodeHex } from "../../../../src/lib/bun-utils.ts";
import { jsonResponse } from "./shared.ts";

interface TraceSummary {
  traceId: string;
  status: number;
  contentType: string;
  bodyHash: Uint8Array;
}

export function formatTraceTable(traces: TraceSummary[]): string {
  const rows = traces.map((t) => ({
    traceId: t.traceId,
    status: String(t.status),
    type: t.contentType,
    hash: encodeHex(t.bodyHash).slice(0, 16) + "...",
    hashWidth: Bun.stringWidth(encodeHex(t.bodyHash)), // 64 for 32-byte SHA-256
  }));
  return Bun.inspect.table(rows, ["traceId", "status", "type", "hash"], { colors: false });
}

export function verifyTraceHash(
  trace: TraceSummary,
  expectedHex: string
): { valid: boolean; checks: Record<string, boolean> } {
  const checks: Record<string, boolean> = {};
  checks.byteLength32 = trace.bodyHash.byteLength === 32;
  checks.hexLength64 = expectedHex.length === 64;
  checks.deepEquals = Bun.deepEquals(trace.bodyHash, decodeHex(expectedHex));
  return { valid: Object.values(checks).every(Boolean), checks };
}

export async function apiTraceVerify(): Promise<Response> {
  const traces: TraceSummary[] = [
    {
      traceId: "req-abc123",
      status: 200,
      contentType: "application/json",
      bodyHash: new Uint8Array(32).fill(0xab),
    },
    {
      traceId: "req-def456",
      status: 404,
      contentType: "text/html",
      bodyHash: new Uint8Array(32).fill(0xcd),
    },
    {
      traceId: "req-ghi789",
      status: 201,
      contentType: "application/octet-stream",
      bodyHash: new Uint8Array(32).fill(0xef),
    },
  ];

  const table = formatTraceTable(traces);

  // Verify first trace
  const expectedHex = "ab".repeat(32);
  const verify = verifyTraceHash(traces[0], expectedHex);

  return jsonResponse({
    table,
    verification: {
      traceId: traces[0].traceId,
      expectedHex: expectedHex.slice(0, 16) + "...",
      checks: verify.checks,
      valid: verify.valid,
    },
    note: "Trace verification: Bun.inspect.table(), Bun.stringWidth(), Bun.deepEquals() with decodeHex() / encodeHex() from bun-utils (Uint8Array.fromHex / toHex).",
  });
}
