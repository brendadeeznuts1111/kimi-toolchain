import { invokeCommand } from "./tool-runner.ts";

/**
 * Kimi doctor wrapper — shared helper to run the official `kimi doctor` command.
 */

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
    const result = await invokeCommand(["kimi", "doctor"], { tool: "kimi" });
    const { exitCode, stdout, stderr, error } = result;
    if (error && exitCode === -1) {
      return { name: "kimi doctor", status: "error", message: error.slice(0, 120) };
    }
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
