/**
 * Low-level macOS memory probes — no logger/tool-runner imports (breaks governor cycle).
 */

import { $ } from "bun";

export async function getFreeMemoryMB(): Promise<number> {
  const vmstat = await $`vm_stat`.quiet().nothrow();
  if (vmstat.exitCode !== 0) return 0;
  const freeMatch = vmstat.stdout.toString().match(/Pages free:\s*(\d+)/);
  const freePages = parseInt(freeMatch?.[1] || "0", 10);
  return Math.round((freePages * 16384) / 1024 / 1024);
}

export async function getSwapUsedMB(): Promise<number> {
  const out = await $`sysctl -n vm.swapusage`.quiet().nothrow();
  if (out.exitCode !== 0) return 0;
  const match = out.stdout.toString().match(/used\s*=\s*([\d.]+)M/i);
  return match ? Math.round(parseFloat(match[1])) : 0;
}

export async function getMemoryPressureFreePct(): Promise<number | null> {
  try {
    const out = await $`memory_pressure -Q`.quiet().nothrow();
    if (out.exitCode !== 0) return null;
    const match = out.stdout.toString().match(/free percentage:\s*(\d+)%/i);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}