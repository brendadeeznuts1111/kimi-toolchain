// ── File I/O ───────────────────────────────────────────────────────

export async function apiFileIO(): Promise<Response> {
  const tmpPath = `/tmp/dashboard-demo-${Date.now()}.txt`;
  const writeStart = Bun.nanoseconds();
  await Bun.write(tmpPath, "Written by Bun.write() — fast, atomic, Bun-native.");
  const writeEnd = Bun.nanoseconds();

  const file = Bun.file(tmpPath);
  const text = await file.text();
  const size = file.size;
  const mime = file.type;
  const exists = await file.exists();

  // Cleanup (best-effort)
  try { await import("node:fs/promises").then(fs => fs.unlink(tmpPath)); } catch { /* ok */ }

  return jsonResponse({
    path: tmpPath,
    writeNs: Number(writeEnd - writeStart),
    read: { size, mime, text, exists },
    note: "Bun.write(path, data) — atomic write. Bun.file(path) — lazy file handle with .text(), .json(), .arrayBuffer(), .exists().",
  });
}

