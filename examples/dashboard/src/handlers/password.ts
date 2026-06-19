// ── Password ──────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiPassword(): Promise<Response> {
  const password = "hunter2";
  const startHash = Bun.nanoseconds();
  const hash = await Bun.password.hash(password);
  const hashEnd = Bun.nanoseconds();
  const verifyOk = await Bun.password.verify(password, hash);
  const verifyBad = await Bun.password.verify("wrong", hash);

  return jsonResponse({
    algorithm: "argon2id (default)",
    hash: hash.slice(0, 40) + "...",
    fullHashLength: hash.length,
    verify: { correct: verifyOk, wrong: verifyBad },
    timing: {
      hashNs: Number(hashEnd - startHash),
      hashMs: Number(hashEnd - startHash) / 1_000_000,
    },
    note: "Bun.password.hash uses argon2id with random salt. Bun.password.verify is constant-time. Async (non-blocking).",
  });
}
