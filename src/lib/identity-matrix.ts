/**
 * Git identity matrix — DX config is source of truth; Git local config is output.
 */

import { dirname, join, resolve } from "path";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import { globalDxConfigPath, homeDir, identityAuditPath } from "./paths.ts";
import { ensureDir, safeToml, sha256String } from "./utils.ts";

export const IDENTITY_MATRIX_SCHEMA_VERSION = 1;

export interface IdentityProfile {
  name: string;
  userName: string;
  userEmail: string;
  signingKey?: string;
  sshKey?: string;
  gpgSign?: boolean;
  remotePatterns: string[];
  pathPatterns: string[];
}

export interface IdentityMatrix {
  schemaVersion: typeof IDENTITY_MATRIX_SCHEMA_VERSION;
  profiles: IdentityProfile[];
  sources: string[];
}

export interface GitIdentity {
  userName?: string;
  userEmail?: string;
  signingKey?: string;
  gpgSign?: boolean;
  sshCommand?: string;
}

export interface IdentityDetection {
  schemaVersion: typeof IDENTITY_MATRIX_SCHEMA_VERSION;
  repoPath: string;
  remoteUrl?: string;
  profile?: IdentityProfile;
  match: "path" | "remote" | "none";
}

export interface IdentitySwitchPlan {
  profile: IdentityProfile;
  repoPath: string;
  previousIdentity: GitIdentity;
  newIdentity: GitIdentity;
  commands: string[][];
}

export interface IdentityAuditRecord {
  schemaVersion: typeof IDENTITY_MATRIX_SCHEMA_VERSION;
  id: string;
  timestamp: string;
  repoPath: string;
  previousProfile?: string;
  newProfile: string;
  reason: string;
  previousIdentity: GitIdentity;
  newIdentity: GitIdentity;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function expandIdentityPath(path: string, home: string = homeDir()): string {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function normalizePath(path: string): string {
  return resolve(expandIdentityPath(path));
}

export function normalizeRemoteUrl(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git$/, "");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesPattern(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.includes("/") ? normalizePath(pattern) : pattern;
  const normalizedValue = pattern.includes("/") ? normalizePath(value) : value;
  return globToRegExp(normalizedPattern).test(normalizedValue);
}

export function parseIdentityMatrixToml(text: string, source = "inline"): IdentityMatrix {
  const parsed = record(safeToml(text, {}));
  const identity = record(parsed.identity);
  const profilesRecord = record(identity.profiles);
  const profiles: IdentityProfile[] = [];

  for (const [name, rawProfile] of Object.entries(profilesRecord)) {
    const profile = record(rawProfile);
    const userName = stringOrUndefined(profile.userName);
    const userEmail = stringOrUndefined(profile.userEmail);
    if (!userName || !userEmail) continue;
    profiles.push({
      name,
      userName,
      userEmail,
      signingKey: stringOrUndefined(profile.signingKey),
      sshKey: stringOrUndefined(profile.sshKey),
      gpgSign: booleanOrUndefined(profile.gpgSign),
      remotePatterns: stringArray(profile.remotePatterns),
      pathPatterns: stringArray(profile.pathPatterns),
    });
  }

  return {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
    profiles,
    sources: profiles.length > 0 ? [source] : [],
  };
}

export async function loadIdentityMatrix(
  options: {
    projectRoot?: string;
    configPaths?: string[];
  } = {}
): Promise<IdentityMatrix> {
  const paths =
    options.configPaths ??
    [
      globalDxConfigPath(),
      options.projectRoot ? join(options.projectRoot, "dx.config.toml") : undefined,
    ].filter((path): path is string => !!path);

  const profiles = new Map<string, IdentityProfile>();
  const sources: string[] = [];
  for (const path of paths) {
    if (!(await Bun.file(path).exists())) continue;
    const matrix = parseIdentityMatrixToml(await Bun.file(path).text(), path);
    if (matrix.profiles.length === 0) continue;
    sources.push(path);
    for (const profile of matrix.profiles) profiles.set(profile.name, profile);
  }

  return {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
    profiles: [...profiles.values()],
    sources,
  };
}

export function detectIdentityProfile(input: {
  matrix: IdentityMatrix;
  repoPath: string;
  remoteUrl?: string;
}): IdentityDetection {
  const repoPath = normalizePath(input.repoPath);
  for (const profile of input.matrix.profiles) {
    if (profile.pathPatterns.some((pattern) => matchesPattern(repoPath, pattern))) {
      return {
        schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
        repoPath,
        remoteUrl: input.remoteUrl,
        profile,
        match: "path",
      };
    }
  }

  if (input.remoteUrl) {
    const remoteCandidates = [input.remoteUrl, normalizeRemoteUrl(input.remoteUrl)];
    for (const profile of input.matrix.profiles) {
      if (
        profile.remotePatterns.some((pattern) =>
          remoteCandidates.some((remote) => matchesPattern(remote, pattern))
        )
      ) {
        return {
          schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
          repoPath,
          remoteUrl: input.remoteUrl,
          profile,
          match: "remote",
        };
      }
    }
  }

  return {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
    repoPath,
    remoteUrl: input.remoteUrl,
    match: "none",
  };
}

export function buildIdentitySwitchPlan(input: {
  profile: IdentityProfile;
  repoPath: string;
  previousIdentity: GitIdentity;
}): IdentitySwitchPlan {
  const profile = input.profile;
  const newIdentity: GitIdentity = {
    userName: profile.userName,
    userEmail: profile.userEmail,
    signingKey: profile.signingKey,
    gpgSign: profile.gpgSign,
    sshCommand: profile.sshKey ? `ssh -i ${normalizePath(profile.sshKey)} -F none` : undefined,
  };
  const commands = [
    ["git", "config", "--local", "user.name", profile.userName],
    ["git", "config", "--local", "user.email", profile.userEmail],
  ];
  if (profile.signingKey)
    commands.push(["git", "config", "--local", "user.signingKey", profile.signingKey]);
  if (profile.gpgSign !== undefined) {
    commands.push(["git", "config", "--local", "commit.gpgSign", String(profile.gpgSign)]);
  }
  if (newIdentity.sshCommand) {
    commands.push(["git", "config", "--local", "core.sshCommand", newIdentity.sshCommand]);
  }

  return {
    profile,
    repoPath: normalizePath(input.repoPath),
    previousIdentity: input.previousIdentity,
    newIdentity,
    commands,
  };
}

function auditId(record: Omit<IdentityAuditRecord, "id">): string {
  return `ident-${sha256String(JSON.stringify(record)).slice(0, 16)}`;
}

export async function appendIdentityAuditRecord(
  projectRoot: string,
  input: Omit<IdentityAuditRecord, "schemaVersion" | "id" | "timestamp">
): Promise<IdentityAuditRecord> {
  const recordWithoutId = {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION as typeof IDENTITY_MATRIX_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const record = { ...recordWithoutId, id: auditId(recordWithoutId) };
  await appendNdjsonRecord(identityAuditPath(projectRoot), record);
  return record;
}

export async function readIdentityAudit(projectRoot: string): Promise<IdentityAuditRecord[]> {
  return readNdjsonFile<IdentityAuditRecord>(identityAuditPath(projectRoot));
}

function quoteToml(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(quoteToml).join(", ")}]`;
}

function profileToToml(profile: IdentityProfile): string {
  const lines = [
    `[identity.profiles.${profile.name}]`,
    `userName = ${quoteToml(profile.userName)}`,
    `userEmail = ${quoteToml(profile.userEmail)}`,
    `remotePatterns = ${tomlArray(profile.remotePatterns)}`,
    `pathPatterns = ${tomlArray(profile.pathPatterns)}`,
  ];
  if (profile.sshKey) lines.push(`sshKey = ${quoteToml(profile.sshKey)}`);
  if (profile.signingKey) lines.push(`signingKey = ${quoteToml(profile.signingKey)}`);
  if (profile.gpgSign !== undefined) lines.push(`gpgSign = ${profile.gpgSign ? "true" : "false"}`);
  return `${lines.join("\n")}\n`;
}

export function upsertIdentityProfileToml(text: string, profile: IdentityProfile): string {
  const section = `[identity.profiles.${profile.name}]`;
  const lines = text.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === section) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*\[/.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return `${kept.join("\n")}\n\n${profileToToml(profile)}`;
}

export async function writeIdentityProfileToDxConfig(
  configPath: string,
  profile: IdentityProfile
): Promise<void> {
  ensureDir(dirname(configPath));
  const file = Bun.file(configPath);
  const text = (await file.exists()) ? await file.text() : "";
  await Bun.write(configPath, upsertIdentityProfileToml(text, profile));
}

export function updateProfileKey(
  matrix: IdentityMatrix,
  profileName: string,
  patch: Pick<IdentityProfile, "sshKey"> | Pick<IdentityProfile, "signingKey" | "gpgSign">
): IdentityProfile | null {
  const current = matrix.profiles.find((profile) => profile.name === profileName);
  return current ? { ...current, ...patch } : null;
}

export function profileMatchesGitIdentity(
  profile: Pick<IdentityProfile, "userName" | "userEmail">,
  identity: GitIdentity
): boolean {
  return profile.userName === identity.userName && profile.userEmail === identity.userEmail;
}
