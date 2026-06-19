// ── Inspect Table ──────────────────────────────────────────────────

export async function apiInspectTable(): Promise<Response> {
  // Array of objects — like a database result
  const users = [
    { name: "Alice", role: "admin", status: "active", loginCount: 42 },
    { name: "Bob", role: "editor", status: "active", loginCount: 17 },
    { name: "Charlie", role: "viewer", status: "inactive", loginCount: 3 },
    { name: "Diana", role: "admin", status: "active", loginCount: 128 },
  ];

  // Full table
  const full = Bun.inspect.table(users);

  // Column-filtered table (only name + role)
  const filtered = Bun.inspect.table(users, ["name", "role"]);

  // With colors disabled (plain text)
  const plain = Bun.inspect.table(users, { colors: false });

  return new Response(
    `// Bun.inspect.table(users)\n${full}\n\n` +
      `// Bun.inspect.table(users, ["name", "role"])\n${filtered}\n\n` +
      `// Bun.inspect.table(users, { colors: false })\n${plain}`,
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}
