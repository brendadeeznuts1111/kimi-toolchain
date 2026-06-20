// ── Password ──────────────────────────────────────────────────────
import { hashPassword, verifyPassword } from "../../../../src/lib/bun-utils.ts";
import { jsonResponse } from "./shared.ts";

export async function apiPassword(): Promise<Response> {
  const plain = "hunter2";
  const startHash = Bun.nanoseconds();
  const hash = await hashPassword(plain);
  const hashEnd = Bun.nanoseconds();
  const verifyOk = await verifyPassword(plain, hash);
  const verifyBad = await verifyPassword("wrong", hash);

  return jsonResponse({
    algorithm: "argon2id (default)",
    hash: hash.slice(0, 40) + "...",
    fullHashLength: hash.length,
    verify: { correct: verifyOk, wrong: verifyBad },
    timing: {
      hashNs: Number(hashEnd - startHash),
      hashMs: Number(hashEnd - startHash) / 1_000_000,
    },
    note: "password.hash (bun-utils) uses argon2id with random salt. password.verify is constant-time. Async (non-blocking).",
  });
}