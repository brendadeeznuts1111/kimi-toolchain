// ── Glob ───────────────────────────────────────────────────────────

export async function apiGlob(): Promise<Response> {
  const patterns = ["*.ts", "**/*.html", "*.{json,toml}"];

  const results: { pattern: string; count: number; matches: string[] }[] = [];
  for (const pat of patterns) {
    const glob = new Bun.Glob(pat);
    const matches: string[] = [];
    for await (const f of glob.scan({ cwd: import.meta.dir, absolute: false })) {
      matches.push(f);
      if (matches.length >= 5) break; // limit per pattern
    }
    results.push({ pattern: pat, count: matches.length, matches });
  }

  return jsonResponse({
    cwd: import.meta.dir,
    results,
    note: "Bun.Glob(pattern).scan() — async iterable. Supports **, *, {a,b} braces. Faster than fs.readdir + regex.",
  });
}

