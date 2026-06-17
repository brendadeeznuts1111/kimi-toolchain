import { readableStreamToText } from "./bun-utils.ts";

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
    const proc = Bun.spawn(["kimi", "doctor"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    const stdout = await readableStreamToText(proc.stdout);
    const stderr = await readableStreamToText(proc.stderr);
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
