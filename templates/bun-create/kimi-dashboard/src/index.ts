/**
 * {{name}} — Bun-native HTTP dashboard scaffolded from kimi-toolchain.
 *
 * Start: bun run dev
 * Open:  http://localhost:5678
 *
 * Handlers live in src/handlers/ — import and register them below.
 * Copy more from the full example: examples/dashboard/src/handlers/
 */

import { text } from "./lib/response.ts";
import * as health from "./handlers/health.ts";
import * as inspect from "./handlers/inspect.ts";
import * as env from "./handlers/env.ts";
import * as crypto from "./handlers/crypto.ts";
import * as cryptoSha3 from "./handlers/crypto-sha3.ts";
import * as file from "./handlers/file.ts";

const port = Number(Bun.env.PORT) || 5678;

// ── Route table ─────────────────────────────────────────────────────

/** Add new handlers here — key is the pathname, value is the exported function. */
const HANDLERS: Record<string, () => Promise<Response>> = {
  "/health": health.apiHealth,
  "/inspect": inspect.apiInspect,
  "/env": env.apiEnv,
  "/crypto": crypto.apiCrypto,
  "/crypto/sha3": cryptoSha3.apiCryptoSha3,
  "/file/range": file.apiFileRange,
};

// ── Server ──────────────────────────────────────────────────────────

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return text("{{name}} — Bun Dashboard\n");
    }

    const handler = HANDLERS[url.pathname];
    if (handler) {
      return await handler();
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`{{name}} running at http://localhost:${port}`);
