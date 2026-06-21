import { join } from "path";
import { pathExists } from "../../bun-io.ts";
import { invokeTool, toolsDir } from "../../tool-runner.ts";

export interface DashboardGateCheckPayload {
  ok: boolean;
  /** When true, one or more gates are failing. */
  failed: boolean;
  failures: Array<{ name: string; message: string }>;
  total: number;
  fetchedAt: string;
}

interface EffectGatesJsonEnvelope {
  effectGates?: {
    regressions?: Array<{ gate?: string; message?: string; location?: string }>;
    current?: { summary?: { total?: number } };
  };
  violations?: Array<{ gate?: string; message?: string; location?: string; severity?: string }>;
  summary?: { ok?: boolean };
}

function resolveKimiDoctorPath(projectPath: string): string | null {
  const local = join(projectPath, "src/bin/kimi-doctor.ts");
  if (pathExists(local)) return local;
  const synced = join(toolsDir(), "kimi-doctor.ts");
  if (pathExists(synced)) return synced;
  return null;
}

function parseEffectGatesEnvelope(stdout: string): {
  failed: boolean;
  failures: Array<{ name: string; message: string }>;
  total: number;
} | null {
  try {
    const parsed = JSON.parse(stdout) as EffectGatesJsonEnvelope;
    if (parsed.summary?.ok === true) {
      return {
        failed: false,
        failures: [],
        total: parsed.effectGates?.current?.summary?.total ?? parsed.violations?.length ?? 0,
      };
    }

    const failures: Array<{ name: string; message: string }> = [];
    for (const violation of parsed.violations ?? []) {
      if (violation.severity !== "error") continue;
      const message = violation.location
        ? `${violation.message ?? "failed"} (${violation.location})`
        : String(violation.message ?? "failed");
      failures.push({ name: String(violation.gate ?? "violation"), message });
    }
    for (const regression of parsed.effectGates?.regressions ?? []) {
      failures.push({
        name: String(regression.gate ?? "regression"),
        message: String(regression.message ?? "regression detected"),
      });
    }

    return {
      failed: true,
      failures,
      total: parsed.effectGates?.current?.summary?.total ?? failures.length,
    };
  } catch {
    return null;
  }
}

/** Run a lightweight doctor gate check and return structured failures. */
export async function fetchDashboardGateHealth(
  projectPath: string
): Promise<DashboardGateCheckPayload> {
  const fetchedAt = new Date().toISOString();
  const doctorPath = resolveKimiDoctorPath(projectPath);
  if (!doctorPath) {
    return {
      ok: false,
      failed: true,
      failures: [
        {
          name: "effect-gates",
          message: "kimi-doctor not found in project src/bin or ~/.kimi-code/tools",
        },
      ],
      total: 0,
      fetchedAt,
    };
  }

  try {
    const result = await invokeTool(
      doctorPath,
      ["--effect-gates", "--json", "--project-root", projectPath],
      { cwd: projectPath, timeoutMs: 60_000 }
    );
    const stdout = result.stdout.trim() || result.stderr.trim();

    if (result.error) {
      return {
        ok: false,
        failed: true,
        failures: [{ name: "effect-gates", message: result.error }],
        total: 0,
        fetchedAt,
      };
    }

    const parsed = parseEffectGatesEnvelope(stdout);
    if (parsed) {
      return {
        ok: true,
        failed: parsed.failed,
        failures: parsed.failures,
        total: parsed.total,
        fetchedAt,
      };
    }

    return {
      ok: true,
      failed: result.exitCode !== 0,
      failures: [
        {
          name: "effect-gates",
          message: stdout.slice(0, 200) || "gate check failed",
        },
      ],
      total: 1,
      fetchedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : Bun.inspect(err);
    return {
      ok: false,
      failed: true,
      failures: [{ name: "effect-gates", message }],
      total: 0,
      fetchedAt,
    };
  }
}
