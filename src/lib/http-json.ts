/** Native Response JSON helpers — single SSOT for dashboard + serve-probe HTTP surfaces. */

import { inspectAgent } from "./inspect.ts";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function jsonResponseCors(body: unknown, status = 200): Response {
  return jsonResponse(body, status, CORS_HEADERS);
}

export function jsonInspectResponseCors(body: unknown, status = 200): Response {
  return new Response(`${inspectAgent(body)}\n`, {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
