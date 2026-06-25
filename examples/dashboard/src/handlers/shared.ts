/** Shared helpers for examples/dashboard API handlers (SSOT). */

import { resolveDashboardProjectRoot } from "../../../../src/lib/dashboard-settings.ts";
import { readableStreamToText } from "../../../../src/lib/bun-utils.ts";
import { buildHttpErrorBody, type FormattedErrorInput } from "../../../../src/lib/error-format.ts";

export type DashboardHttpMethod = "GET" | "POST" | "HEAD";

export function resolveRoot(): string {
  return resolveDashboardProjectRoot(import.meta.dir);
}

export function doctorBin(): string {
  const root = resolveRoot();
  return Bun.which("kimi-doctor") || `${root}/src/bin/kimi-doctor.ts`;
}

import { jsonResponse } from "../../../../src/lib/http-json.ts";
export { jsonResponse };

/** Structured reverse-domain error envelope for dashboard API handlers. */
export function jsonErrorResponse(
  input: FormattedErrorInput,
  status = 400,
  extra?: Record<string, unknown>
): Response {
  return jsonResponse(buildHttpErrorBody(input, extra), status);
}

/** JSON 405 for API namespaces (matches artifact handler shape). */
export function methodNotAllowedJson(
  method: string,
  path: string,
  allowed: readonly DashboardHttpMethod[] = ["GET"]
): Response {
  return jsonResponse(
    {
      ok: false,
      error: "Method Not Allowed",
      method,
      path,
      allowed,
    },
    405
  );
}

export function isAllowedMethod(
  method: string,
  allowed: readonly DashboardHttpMethod[]
): method is DashboardHttpMethod {
  return (allowed as readonly string[]).includes(method);
}

/** Spawn kimi-doctor --json with exit-code and parse guards. */
export async function runDoctorJson(extraArgs: readonly string[]): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", doctorBin(), ...extraArgs, "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return jsonResponse(
      {
        ok: false,
        exitCode,
        error: stderr.trim() || "kimi-doctor failed",
        ...(stdout.trim() ? { stdout: stdout.trim() } : {}),
      },
      502
    );
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    return jsonResponse({ ok: false, error: "kimi-doctor returned empty stdout" }, 502);
  }
  try {
    return jsonResponse(JSON.parse(trimmed));
  } catch {
    return jsonResponse(
      { ok: false, error: "invalid JSON from kimi-doctor", raw: trimmed.slice(0, 500) },
      502
    );
  }
}
