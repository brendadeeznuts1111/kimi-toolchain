// templates/modules/http/src/init.ts
// KIMI_MODULES symbol registration for the HTTP client module.

import { createHttpProcessor } from "./processor.ts";

export const http = createHttpProcessor({
  minTLS: "TLSv1.2", // production floor
});

globalThis[Symbol.for("kimi.effect.http")] = http;
