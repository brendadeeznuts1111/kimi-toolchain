/** Shared helpers for examples/dashboard API handlers (SSOT). */

export function resolveRoot(): string {
  const dir = import.meta.dir;
  if (dir.includes("kimi-toolchain")) {
    return dir.split("kimi-toolchain")[0] + "kimi-toolchain";
  }
  return process.cwd();
}

export function doctorBin(): string {
  const root = resolveRoot();
  return Bun.which("kimi-doctor") || `${root}/src/bin/kimi-doctor.ts`;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}