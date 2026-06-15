#!/usr/bin/env bun
/**
 * kimi-identity — DX-backed Git identity matrix.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { globalDxConfigPath } from "../lib/paths.ts";
import {
  IDENTITY_MATRIX_SCHEMA_VERSION,
  appendIdentityAuditRecord,
  buildIdentitySwitchPlan,
  detectIdentityProfile,
  expandIdentityPath,
  loadIdentityMatrix,
  profileMatchesGitIdentity,
  readIdentityAudit,
  updateProfileKey,
  writeIdentityProfileToDxConfig,
  type GitIdentity,
  type IdentityMatrix,
  type IdentityProfile,
} from "../lib/identity-matrix.ts";

const logger = createLogger(Bun.argv, "kimi-identity");

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

function writeJson(value: unknown): void {
  Bun.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function git(
  repoPath: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    Bun.readableStreamToText(proc.stdout),
  ]);
  await Bun.readableStreamToText(proc.stderr);
  return { exitCode, stdout: stdout.trim() };
}

async function gitConfigGet(repoPath: string, key: string): Promise<string | undefined> {
  const result = await git(repoPath, ["config", "--get", key]);
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
}

async function gitConfigSet(repoPath: string, key: string, value: string): Promise<void> {
  const result = await git(repoPath, ["config", "--local", key, value]);
  if (result.exitCode !== 0) throw new Error(`git config failed for ${key}`);
}

async function resolveRepoPath(): Promise<string> {
  const explicit = argValue("--repo");
  return explicit ? expandIdentityPath(explicit) : resolveProjectRoot(Bun.cwd);
}

async function readRemote(repoPath: string): Promise<string | undefined> {
  const result = await git(repoPath, ["remote", "get-url", "origin"]);
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
}

async function readGitIdentity(repoPath: string): Promise<GitIdentity> {
  const [userName, userEmail, signingKey, gpgSignRaw, sshCommand] = await Promise.all([
    gitConfigGet(repoPath, "user.name"),
    gitConfigGet(repoPath, "user.email"),
    gitConfigGet(repoPath, "user.signingKey"),
    gitConfigGet(repoPath, "commit.gpgSign"),
    gitConfigGet(repoPath, "core.sshCommand"),
  ]);
  return {
    userName,
    userEmail,
    signingKey,
    gpgSign: gpgSignRaw === undefined ? undefined : gpgSignRaw === "true",
    sshCommand,
  };
}

function findActiveProfile(
  matrix: IdentityMatrix,
  identity: GitIdentity
): IdentityProfile | undefined {
  return matrix.profiles.find((profile) => profileMatchesGitIdentity(profile, identity));
}

async function context(repoPath: string): Promise<{
  matrix: IdentityMatrix;
  identity: GitIdentity;
  remoteUrl?: string;
}> {
  const [matrix, identity, remoteUrl] = await Promise.all([
    loadIdentityMatrix({ projectRoot: repoPath }),
    readGitIdentity(repoPath),
    readRemote(repoPath),
  ]);
  return { matrix, identity, remoteUrl };
}

function printHelp(): void {
  logger.section("kimi-identity commands");
  logger.line("  list [--json]");
  logger.line("  auto [--repo <path>] [--json]");
  logger.line("  switch --profile <name> [--repo <path>] [--reason <text>] [--json]");
  logger.line("  bind --profile <name> --key <path> [--json]");
  logger.line("  sign --profile <name> --gpg-key <id> [--json]");
}

function profileOrThrow(matrix: IdentityMatrix, name: string): IdentityProfile {
  const profile = matrix.profiles.find((item) => item.name === name);
  if (!profile) throw new Error(`Unknown identity profile: ${name}`);
  return profile;
}

async function commandList(jsonMode: boolean): Promise<number> {
  const repoPath = await resolveRepoPath();
  const { matrix, identity, remoteUrl } = await context(repoPath);
  const activeProfile = findActiveProfile(matrix, identity);
  const detection = detectIdentityProfile({ matrix, repoPath, remoteUrl });
  const report = {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
    tool: "kimi-identity",
    profiles: matrix.profiles,
    activeProfile: activeProfile?.name,
    expectedProfile: detection.profile?.name,
    match: detection.match,
    identity,
    sources: matrix.sources,
  };
  if (jsonMode) writeJson(report);
  else {
    logger.section("Identity Matrix");
    logger.info(`${matrix.profiles.length} profile(s)`);
    for (const profile of matrix.profiles) {
      const active = profile.name === activeProfile?.name ? "*" : " ";
      const expected = profile.name === detection.profile?.name ? "expected" : "";
      logger.line(
        `  ${active} ${profile.name} ${profile.userName} <${profile.userEmail}> ${expected}`
      );
    }
  }
  return 0;
}

async function commandAuto(jsonMode: boolean): Promise<number> {
  const repoPath = await resolveRepoPath();
  const { matrix, remoteUrl } = await context(repoPath);
  const detection = detectIdentityProfile({ matrix, repoPath, remoteUrl });
  const report = { ...detection, tool: "kimi-identity" };
  if (jsonMode) writeJson(report);
  else {
    logger.section("Identity Auto Detect");
    logger.info(detection.profile ? `${detection.profile.name} (${detection.match})` : "No match");
  }
  return 0;
}

async function commandSwitch(jsonMode: boolean): Promise<number> {
  const profileName = argValue("--profile");
  if (!profileName) {
    logger.error("Usage: switch --profile <name> [--repo <path>] [--reason <text>] [--json]");
    return 1;
  }

  const repoPath = await resolveRepoPath();
  const { matrix, identity } = await context(repoPath);
  const profile = profileOrThrow(matrix, profileName);
  const previousProfile = findActiveProfile(matrix, identity);
  const plan = buildIdentitySwitchPlan({ profile, repoPath, previousIdentity: identity });
  for (const command of plan.commands) await gitConfigSet(repoPath, command[3]!, command[4]!);

  const audit = await appendIdentityAuditRecord(repoPath, {
    repoPath,
    previousProfile: previousProfile?.name,
    newProfile: profile.name,
    reason: argValue("--reason") ?? "cli",
    previousIdentity: identity,
    newIdentity: plan.newIdentity,
  });
  const report = {
    schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION,
    tool: "kimi-identity",
    plan,
    audit,
  };
  if (jsonMode) writeJson(report);
  else {
    logger.section("Identity Switch");
    logger.info(`${profile.name}: ${profile.userName} <${profile.userEmail}>`);
    logger.info(`Audit: ${audit.id}`);
  }
  return 0;
}

async function commandBind(jsonMode: boolean): Promise<number> {
  const profileName = argValue("--profile");
  const key = argValue("--key");
  if (!profileName || !key) {
    logger.error("Usage: bind --profile <name> --key <path> [--json]");
    return 1;
  }
  const keyPath = expandIdentityPath(key);
  if (!(await Bun.file(keyPath).exists())) throw new Error(`SSH key does not exist: ${keyPath}`);
  const matrix = await loadIdentityMatrix({ configPaths: [globalDxConfigPath()] });
  const profile = updateProfileKey(matrix, profileName, { sshKey: keyPath });
  if (!profile) throw new Error(`Unknown identity profile: ${profileName}`);
  await writeIdentityProfileToDxConfig(globalDxConfigPath(), profile);
  const report = { schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION, tool: "kimi-identity", profile };
  if (jsonMode) writeJson(report);
  else logger.info(`Bound ${profile.name} to ${keyPath}`);
  return 0;
}

async function commandSign(jsonMode: boolean): Promise<number> {
  const profileName = argValue("--profile");
  const signingKey = argValue("--gpg-key");
  if (!profileName || !signingKey) {
    logger.error("Usage: sign --profile <name> --gpg-key <id> [--json]");
    return 1;
  }
  const matrix = await loadIdentityMatrix({ configPaths: [globalDxConfigPath()] });
  const profile = updateProfileKey(matrix, profileName, { signingKey, gpgSign: true });
  if (!profile) throw new Error(`Unknown identity profile: ${profileName}`);
  await writeIdentityProfileToDxConfig(globalDxConfigPath(), profile);
  const report = { schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION, tool: "kimi-identity", profile };
  if (jsonMode) writeJson(report);
  else logger.info(`Configured signing for ${profile.name}`);
  return 0;
}

async function main(): Promise<number> {
  const command = Bun.argv[2] ?? "help";
  const jsonMode = hasFlag("--json");
  if (command === "list") return commandList(jsonMode);
  if (command === "auto") return commandAuto(jsonMode);
  if (command === "switch") return commandSwitch(jsonMode);
  if (command === "bind") return commandBind(jsonMode);
  if (command === "sign") return commandSign(jsonMode);
  if (command === "audit") {
    const repoPath = await resolveRepoPath();
    const records = await readIdentityAudit(repoPath);
    if (jsonMode)
      writeJson({ schemaVersion: IDENTITY_MATRIX_SCHEMA_VERSION, tool: "kimi-identity", records });
    else logger.info(`${records.length} audit record(s)`);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  printHelp();
  return 1;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-identity", logger }
  );
  process.exit(exitCode);
}
