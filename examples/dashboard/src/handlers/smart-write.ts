// ── Smart Write ────────────────────────────────────────────────────

export async function apiWriteSmart(): Promise<Response> {
  const { types } = await import("node:util");
  const tmpPath = `/tmp/dashboard-smart-${Date.now()}.txt`;

  const testCases: { label: string; value: unknown; branch: string }[] = [
    { label: "string", value: "plain text", branch: "" },
    { label: "Uint8Array", value: new Uint8Array([104, 101, 108, 108, 111]), branch: "" },
    { label: "ArrayBuffer", value: new Uint8Array([119, 111, 114, 108, 100]).buffer, branch: "" },
    { label: "number → String", value: 42, branch: "" },
    { label: "null → String", value: null, branch: "" },
  ];

  const results: { label: string; branch: string; wrote: string; read: string }[] = [];

  for (const tc of testCases) {
    let branch = "";
    try {
      if (tc.value instanceof Blob) {
        branch = "Blob";
        await Bun.write(tmpPath, tc.value);
      } else if (typeof tc.value === "string" || types.isArrayBufferView(tc.value) || types.isAnyArrayBuffer(tc.value)) {
        branch = typeof tc.value === "string" ? "string" : types.isArrayBufferView(tc.value) ? "ArrayBufferView" : "ArrayBuffer";
        await Bun.write(tmpPath, tc.value);
      } else {
        branch = "String(value)";
        await Bun.write(tmpPath, String(tc.value));
      }
      const content = await Bun.file(tmpPath).text();
      results.push({ label: tc.label, branch, wrote: String(tc.value).slice(0, 30), read: content });
    } catch (err) {
      results.push({ label: tc.label, branch, wrote: "—", read: `ERROR: ${err}` });
    }
  }

  try { await import("node:fs/promises").then(fs => fs.unlink(tmpPath)); } catch { /* ok */ }

  return jsonResponse({
    results,
    note: "Smart write: branch on instanceof Blob → string → isArrayBufferView → isAnyArrayBuffer → fallback String(). Uses node:util/types for safe type detection.",
  });
}

