/**
 * Track healing playbooks applied to error clusters.
 */

import { dirname } from "path";
import { makeDir } from "./bun-io.ts";
import { clusterPlaybooksPath } from "./paths.ts";
import { safeParse } from "./utils.ts";

export interface ClusterPlaybookRecord {
  clusterId: string;
  title: string;
  command?: string[];
  appliedAt: string;
  outcome: "success" | "failed";
  confidence: number;
}

export interface ClusterPlaybookStore {
  schemaVersion: 1;
  updatedAt: string;
  playbooks: Record<string, ClusterPlaybookRecord>;
}

export async function readClusterPlaybooks(
  path: string = clusterPlaybooksPath()
): Promise<ClusterPlaybookStore> {
  if (!(await Bun.file(path).exists())) return emptyStore();
  const text = await Bun.file(path).text();
  const parsed = safeParse<ClusterPlaybookStore | null>(text, null);
  if (!parsed || parsed.schemaVersion !== 1) return emptyStore();
  return parsed;
}

export async function writeClusterPlaybooks(
  store: ClusterPlaybookStore,
  path: string = clusterPlaybooksPath()
): Promise<void> {
  makeDir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(store, null, 2)}\n`);
}

export async function recordClusterPlaybook(
  record: ClusterPlaybookRecord,
  path: string = clusterPlaybooksPath()
): Promise<ClusterPlaybookStore> {
  const store = await readClusterPlaybooks(path);
  store.playbooks[record.clusterId] = record;
  store.updatedAt = new Date().toISOString();
  await writeClusterPlaybooks(store, path);
  return store;
}

export function hasSuccessfulPlaybook(clusterId: string, store: ClusterPlaybookStore): boolean {
  const record = store.playbooks[clusterId];
  return record?.outcome === "success";
}

export function getClusterPlaybook(
  clusterId: string,
  store: ClusterPlaybookStore
): ClusterPlaybookRecord | undefined {
  const record = store.playbooks[clusterId];
  return record?.outcome === "success" ? record : undefined;
}

function emptyStore(): ClusterPlaybookStore {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    playbooks: {},
  };
}
