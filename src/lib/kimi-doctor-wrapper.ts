/**
 * Kimi doctor wrapper — shared helper to run the official `kimi doctor` command.
 */

import { invokeCommand } from "./tool-runner.ts";

export interface KimiDoctorResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function runOfficialKimiDoctor(): Promise<KimiDoctorResult> {
  const kimiPath = Bun.which("kimi");
  if (!kimiPath) {
    return { name: "kimi doctor", status: "error", message: "kimi not installed" };
  }
  try {
    const result = await invokeCommand(["kimi", "doctor"], { timeoutMs: 30_000 });
    const exitCode = result.exitCode;
    const stdout = result.stdout;
    const stderr = result.stderr;
    if (exitCode === 0) {
      const line = stdout
        .split("\n")
        .find((l) => l.trim())
        ?.trim();
      return { name: "kimi doctor", status: "ok", message: line || "passed" };
    }
    const detail =
      stderr
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ||
      stdout
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ||
      `exit ${exitCode}`;
    return { name: "kimi doctor", status: "error", message: detail.slice(0, 120) };
  } catch (e: unknown) {
    return {
      name: "kimi doctor",
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
