/**
 * Machine ~/.bunfig.toml SSOT — project keys unset inherit from machine layer.
 */

import type { BunfigInstallSection } from "./bun-install-types.ts";
import { readUserBunfigInstall } from "./bunfig-redundancy.ts";

export type MachineSsotKey = "linker" | "globalStore" | "cacheDir";

export type MachineSsotStatus = "inherited" | "project" | "override" | "unset";

export interface MachineSsotEntry {
  key: MachineSsotKey;
  bunfigKey: string;
  status: MachineSsotStatus;
  effective: string | null;
  machineValue: string | null;
  projectValue: string | null;
  note: string;
}

export const MACHINE_BUNFIG_LABEL = "~/.bunfig.toml";

export type MachineSsotSummary = Record<
  MachineSsotKey,
  Pick<MachineSsotEntry, "status" | "effective" | "machineValue" | "projectValue">
>;

export function ssotEntry(
  entries: MachineSsotEntry[],
  key: MachineSsotKey
): MachineSsotEntry | undefined {
  return entries.find((entry) => entry.key === key);
}

export function buildSsotSummary(entries: MachineSsotEntry[]): MachineSsotSummary {
  return {
    linker: pickSsotSummary(entries, "linker"),
    globalStore: pickSsotSummary(entries, "globalStore"),
    cacheDir: pickSsotSummary(entries, "cacheDir"),
  };
}

function pickSsotSummary(
  entries: MachineSsotEntry[],
  key: MachineSsotKey
): MachineSsotSummary[MachineSsotKey] {
  const entry = ssotEntry(entries, key);
  return {
    status: entry?.status ?? "unset",
    effective: entry?.effective ?? null,
    machineValue: entry?.machineValue ?? null,
    projectValue: entry?.projectValue ?? null,
  };
}

/** Policy row satisfied by project declaration or machine inheritance. */
export function ssotSatisfiesInstallPolicy(
  entries: MachineSsotEntry[],
  key: MachineSsotKey
): boolean {
  const status = ssotEntry(entries, key)?.status;
  return status === "inherited" || status === "project";
}

export function formatSsotDisplayValue(entry: MachineSsotEntry | undefined): string {
  if (!entry || entry.effective == null) return "unset";
  const tag =
    entry.status === "inherited"
      ? "inherited"
      : entry.status === "override"
        ? "override"
        : entry.status === "project"
          ? "project"
          : null;
  return tag ? `${entry.effective} (${tag})` : entry.effective;
}

function linkerEntry(
  project: BunfigInstallSection | null,
  machineInstall: BunfigInstallSection | null,
  machinePath: string | null
): MachineSsotEntry {
  const machineValue = machineInstall?.linker ?? null;
  const projectValue = project?.linker ?? null;
  const bunfigKey = "[install].linker";

  if (projectValue != null && machineValue != null && projectValue !== machineValue) {
    return {
      key: "linker",
      bunfigKey,
      status: "override",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project override; machine=${machineValue})`,
    };
  }

  if (projectValue != null) {
    return {
      key: "linker",
      bunfigKey,
      status: "project",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project)`,
    };
  }

  if (machineValue != null && machinePath) {
    return {
      key: "linker",
      bunfigKey,
      status: "inherited",
      effective: machineValue,
      machineValue,
      projectValue: null,
      note: `${bunfigKey}: inherited from ${MACHINE_BUNFIG_LABEL} (${machineValue})`,
    };
  }

  return {
    key: "linker",
    bunfigKey,
    status: "unset",
    effective: null,
    machineValue,
    projectValue: null,
    note: `${bunfigKey}: unset (no project or machine value)`,
  };
}

function globalStoreEntry(
  project: BunfigInstallSection | null,
  machineInstall: BunfigInstallSection | null,
  machinePath: string | null
): MachineSsotEntry {
  const machineValue =
    machineInstall?.globalStore === true
      ? "true"
      : machineInstall?.globalStore === false
        ? "false"
        : null;
  const projectRaw = project?.globalStore;
  const projectValue = projectRaw === true ? "true" : projectRaw === false ? "false" : null;
  const bunfigKey = "[install].globalStore";

  if (projectValue != null && machineValue != null && projectValue !== machineValue) {
    return {
      key: "globalStore",
      bunfigKey,
      status: "override",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project override; machine=${machineValue})`,
    };
  }

  if (projectValue != null) {
    return {
      key: "globalStore",
      bunfigKey,
      status: "project",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project)`,
    };
  }

  if (machineValue != null && machinePath) {
    return {
      key: "globalStore",
      bunfigKey,
      status: "inherited",
      effective: machineValue,
      machineValue,
      projectValue: null,
      note: `${bunfigKey}: inherited from ${MACHINE_BUNFIG_LABEL} (${machineValue})`,
    };
  }

  return {
    key: "globalStore",
    bunfigKey,
    status: "unset",
    effective: null,
    machineValue,
    projectValue: null,
    note: `${bunfigKey}: unset (no project or machine value)`,
  };
}

function cacheDirEntry(
  project: BunfigInstallSection | null,
  machineCacheDir: string | null,
  machinePath: string | null
): MachineSsotEntry {
  const machineValue = machineCacheDir;
  const projectValue = project?.cache?.dir ?? null;
  const bunfigKey = "[install.cache].dir";

  if (projectValue != null && machineValue != null && projectValue !== machineValue) {
    return {
      key: "cacheDir",
      bunfigKey,
      status: "override",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project override; machine=${machineValue})`,
    };
  }

  if (projectValue != null) {
    return {
      key: "cacheDir",
      bunfigKey,
      status: "project",
      effective: projectValue,
      machineValue,
      projectValue,
      note: `${bunfigKey}: ${projectValue} (project)`,
    };
  }

  if (machineValue != null && machinePath) {
    return {
      key: "cacheDir",
      bunfigKey,
      status: "inherited",
      effective: machineValue,
      machineValue,
      projectValue: null,
      note: `${bunfigKey}: inherited from ${MACHINE_BUNFIG_LABEL} (${machineValue})`,
    };
  }

  return {
    key: "cacheDir",
    bunfigKey,
    status: "unset",
    effective: null,
    machineValue,
    projectValue: null,
    note: `${bunfigKey}: unset (no project or machine value)`,
  };
}

export function resolveMachineInstallSsot(
  projectInstall: BunfigInstallSection | null,
  machine: Awaited<ReturnType<typeof readUserBunfigInstall>>
): MachineSsotEntry[] {
  const machineInstall = machine.install;
  return [
    linkerEntry(projectInstall, machineInstall, machine.bunfigPath),
    globalStoreEntry(projectInstall, machineInstall, machine.bunfigPath),
    cacheDirEntry(projectInstall, machine.cacheDir, machine.bunfigPath),
  ];
}

export function inheritedSsotNotes(entries: MachineSsotEntry[]): string[] {
  return entries.filter((e) => e.status === "inherited").map((e) => e.note);
}

export function overrideSsotWarnings(entries: MachineSsotEntry[]): string[] {
  return entries.filter((e) => e.status === "override").map((e) => e.note);
}

export function unsetSsotWarnings(entries: MachineSsotEntry[]): string[] {
  return entries.filter((e) => e.status === "unset").map((e) => e.note);
}

/** Drop project-layer warnings satisfied by machine SSOT inheritance. */
export function suppressInheritedSsotWarning(
  warning: string,
  entries: MachineSsotEntry[]
): boolean {
  for (const entry of entries) {
    if (entry.status !== "inherited") continue;
    if (entry.key === "linker") {
      if (
        warning.includes("[install].linker") ||
        warning.startsWith("linker unset") ||
        warning.startsWith("linker=")
      ) {
        return true;
      }
    }
    if (entry.key === "globalStore") {
      if (
        warning.includes("[install].globalStore") ||
        warning.startsWith("globalStore unset") ||
        warning.startsWith("globalStore=")
      ) {
        return true;
      }
    }
    if (entry.key === "cacheDir") {
      if (
        warning.includes("[install.cache].dir") ||
        warning.startsWith("cacheDir unset") ||
        warning.startsWith("cacheDir=")
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function readMachineInstallSsot(
  projectInstall: BunfigInstallSection | null
): Promise<MachineSsotEntry[]> {
  const machine = await readUserBunfigInstall();
  return resolveMachineInstallSsot(projectInstall, machine);
}
