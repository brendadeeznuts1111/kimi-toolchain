/**
 * Shared response helpers for the dashboard handler modules.
 */

export function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function text(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
