import { jsonResponse } from "./shared.ts";

export async function apiFileSplit(): Promise<Response> {
  const sample = `// ── Health ────────────────────────────────────────────────────────
export async function apiHealth() {
  return json({ status: "ok" });
}

// ── Inspect ────────────────────────────────────────────────────────
export async function apiInspect() {
  const obj = { nested: { a: 1 } };
  return json({ default: Bun.inspect(obj) });
}

// ── Crypto ─────────────────────────────────────────────────────────
export async function apiCrypto() {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update("hello");
  return json({ sha256: hash.digest("hex") });
}`;

  const sections: { name: string; content: string }[] = [];
  let currentName = "preamble";
  let currentContent = "";

  for (const line of sample.split("\n")) {
    const match = line.match(/^\/\/ ── (.+) ──+$/);
    if (match) {
      if (currentContent.trim()) {
        sections.push({ name: currentName, content: currentContent.trim() });
      }
      currentName = match[1]
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      currentContent = "";
    } else {
      currentContent += line + "\n";
    }
  }
  if (currentContent.trim()) {
    sections.push({ name: currentName, content: currentContent.trim() });
  }

  return jsonResponse({
    inputLines: sample.split("\n").length,
    sections: sections.map((s) => ({
      file: `${s.name}.ts`,
      lines: s.content.split("\n").filter(Boolean).length,
      preview: s.content.slice(0, 80) + (s.content.length > 80 ? "..." : ""),
    })),
    awkCommand: `for f in *.ts; do awk '/^\\/\\/ === .* ===$/{out=substr($0,6,length($0)-10); gsub(/[^a-z0-9.\\/]/,"-",out); next} out{print > out}' "$f"; done`,
    note: "awk one-liner splits TypeScript files by // ── Section ── markers into per-handler files.",
  });
}
