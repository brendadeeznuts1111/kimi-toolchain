/**
 * Track healing playbooks applied to error clusters.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
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
  if (!existsSync(path)) return emptyStore();
  const text = await Bun.file(path).text();
  const parsed = safeParse<ClusterPlaybookStore | null>(text, null);
  if (!parsed || parsed.schemaVersion !== 1) return emptyStore();
  return parsed;
}

export function writeClusterPlaybooks(
  store: ClusterPlaybookStore,
  path: string = clusterPlaybooksPath()
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

export function recordClusterPlaybook(
  record: ClusterPlaybookRecord,
  path: string = clusterPlaybooksPath()
): Promise<ClusterPlaybookStore> {
  return readClusterPlaybooks(path).then((store) => {
    store.playbooks[record.clusterId] = record;
    store.updatedAt = new Date().toISOString();
    writeClusterPlaybooks(store, path);
    return store;
  });
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
