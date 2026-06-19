// ── Peek ───────────────────────────────────────────────────────────

export async function apiPeek(): Promise<Response> {
  const pending = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5000));
  const fulfilled = Promise.resolve(42);
  const _rejected = Promise.reject(new Error("boom")).catch(() => {});

  // Peek at the pending promise (status only — value not available)
  const pendingStatus = Bun.peek.status(pending);

  // Peek at fulfilled promise
  const fulfilledValue = Bun.peek(fulfilled);
  const fulfilledStatus = Bun.peek.status(fulfilled);

  // Clean up the pending setTimeout
  // (can't easily cancel, but it won't affect response)

  return jsonResponse({
    pending: { status: pendingStatus, value: Bun.peek(pending) },
    fulfilled: { status: fulfilledStatus, value: fulfilledValue },
    note: "Bun.peek.status(p) → 'pending'|'fulfilled'|'rejected'. Bun.peek(p) extracts value if fulfilled (sync, same tick).",
  });
}
