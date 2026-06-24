// templates/modules/http/src/init.ts
// KIMI_MODULES symbol registration for the HTTP client module.

import { createHttpProcessor } from "./processor.ts";

export const http = createHttpProcessor({
  minTls: "TLSv1.2", // production floor
});

(globalThis as typeof globalThis & Record<symbol, unknown>)[Symbol.for("kimi.effect.http")] = http;
