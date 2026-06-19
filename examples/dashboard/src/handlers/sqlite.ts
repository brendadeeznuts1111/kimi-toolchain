// ── SQLite ─────────────────────────────────────────────────────────

export async function apiSqlite(): Promise<Response> {
  const db = new (await import("bun:sqlite")).Database(":memory:");
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
  db.run("INSERT INTO users VALUES (?, ?, ?)", [1, "Alice", "alice@example.com"]);
  db.run("INSERT INTO users VALUES (?, ?, ?)", [2, "Bob", "bob@example.com"]);
  db.run("INSERT INTO users VALUES (?, ?, ?)", [3, "Charlie", "charlie@example.com"]);

  const all = db.query("SELECT * FROM users").all();
  const count = db.query("SELECT COUNT(*) as n FROM users").get() as { n: number };
  db.close();

  return jsonResponse({
    engine: "bun:sqlite (in-memory)",
    schema: ["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"],
    rows: all,
    count: count.n,
    note: "bun:sqlite Database(':memory:') — zero-config embedded SQL. WAL mode by default. Supports prepared statements, transactions.",
  });
}
