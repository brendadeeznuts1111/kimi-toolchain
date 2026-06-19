// ── Deep Match ─────────────────────────────────────────────────────

export async function apiDeepMatch(): Promise<Response> {
  const traces = [
    { traceId: "abc-123", status: 200, contentType: "application/json" },
    { traceId: "def-456", status: 404, contentType: "text/html" },
    { traceId: null, status: "bad", contentType: "text/plain" }, // bad shape
  ];

  const results = traces.map((t) => {
    // Production: manual type checks
    const prodCheck = typeof t.traceId === "string" && typeof t.status === "number";

    // Exact structural match
    const exactMatch = Bun.deepMatch(t, {
      traceId: "abc-123",
      status: 200,
      contentType: "application/json",
    });

    return {
      trace: JSON.stringify(t),
      prodCheck,
      exactMatch,
      shape: prodCheck ? "valid" : "invalid",
    };
  });

  return jsonResponse({
    results,
    validCount: results.filter((r) => r.prodCheck).length,
    note: "Bun.deepMatch(a, b) — exact structural match (not subset). Manual type checks (typeof) for shape validation. expect.any() matchers with deepMatch not yet available in Bun v1.4.0-canary.",
  });
}
