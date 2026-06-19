// ── Nanoseconds ────────────────────────────────────────────────────

export async function apiNanoseconds(): Promise<Response> {
  const start = Bun.nanoseconds();
  let x = 0;
  for (let i = 0; i < 1000; i++) x += Math.sqrt(i);
  const end = Bun.nanoseconds();

  return jsonResponse({
    start: Number(start),
    end: Number(end),
    elapsed: Number(end - start),
    unit: "nanoseconds",
    note: `Bun.nanoseconds() → bigint. Elapsed: ${end - start}ns for 1000 Math.sqrt() calls.`,
  });
}

