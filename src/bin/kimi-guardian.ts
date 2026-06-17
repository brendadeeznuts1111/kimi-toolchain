#!/usr/bin/env bun
import { makeDir, pathExists } from "../lib/bun-io.ts";
/**
 * Kimi Guardian — Bun-native supply chain security
 * v2.0: Signed lockfile manifests, Bun.secrets integration, first-commit poisoning defense
 * P0: Lockfile integrity, dependency drift, trusted deps
 * P1: Transitive provenance
 *
 * Usage:
 *   kimi-guardian [check|fix|report|sign|verify|doctor]
 */

import { $, randomUUIDv7 } from "bun";
import { Database } from "bun:sqlite";
import { join } from "path";
import {
  ensureDir,
  sha256File,
  fetchWithTimeout,
  getProjectName,
  resolveProjectRoot,
} from "../lib/utils.ts";

import { guardianDir } from "../lib/paths.ts";
import {
  addTrustedDependencies,
  scanUntrustedInstallScripts,
  trustedDependenciesFixHint,
} from "../lib/trusted-dependencies.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-guardian");

const GUARDIAN_DIR = guardianDir();
const HASH_FILE = join(GUARDIAN_DIR, "lockfile.hash");
const MANIFEST_DB = join(GUARDIAN_DIR, "manifests.sqlite");
const KEY_NAME = "kimi-guardian-lockfile";

interface LockfileManifest {
  projectPath: string;
  lockfileHash: string;
  signature: string;
  signedBy: string;
  timestamp: number;
  ttl: number;
}

interface GuardianReport {
  project: string;
  lockfile: {
    path: string;
    hash: string;
    hashMatch: boolean | null;
    stale: boolean;
    manifestValid: boolean | null;
  };
  dependencies: {
    outdated: Array<{ name: string; current: string; latest: string }>;
    cves: Array<{ name: string; cveId: string; severity: string }>;
    untrusted: string[];
  };
  provenance?: {
    postinstallScripts: Array<{ pkg: string; script: string }>;
    lowBusFactor: string[];
  };
}

interface DbManifestRow {
  project_path: string;
  lockfile_hash: string;
  signature: string;
  signed_by: string;
  timestamp: number;
  ttl: number;
}

interface DbCountRow {
  c: number;
}

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: {
    postinstall?: string;
    preinstall?: string;
    install?: string;
  };
  repository?: { url?: string } | string;
}

// ── Database ─────────────────────────────────────────────────────────

function getDb(): Database {
  if (!pathExists(GUARDIAN_DIR)) makeDir(GUARDIAN_DIR, { recursive: true });
  const db = new Database(MANIFEST_DB, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS manifests (
      project_path TEXT PRIMARY KEY,
      lockfile_hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      signed_by TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      ttl INTEGER NOT NULL DEFAULT 2592000
    );
    CREATE INDEX IF NOT EXISTS idx_manifests_project ON manifests(project_path);
  `);
  return db;
}

// ── Signed Manifests (v2) ────────────────────────────────────────────

async function signManifest(projectDir: string, hash: string): Promise<LockfileManifest> {
  let key = await getSigningKey();
  if (!key) {
    key = await createSigningKey();
  }

  const db = getDb();

  const timestamp = Date.now();
  const ttl = 30 * 24 * 60 * 60 * 1000;
  const payload = `${projectDir}:${hash}:${timestamp}`;

  const hmac = new Bun.CryptoHasher("sha256");
  hmac.update(key);
  hmac.update(payload);
  const signature = hmac.digest("hex");

  const manifest: LockfileManifest = {
    projectPath: projectDir,
    lockfileHash: hash,
    signature,
    signedBy: KEY_NAME,
    timestamp,
    ttl,
  };

  db.run(
    `INSERT OR REPLACE INTO manifests (project_path, lockfile_hash, signature, signed_by, timestamp, ttl)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      manifest.projectPath,
      manifest.lockfileHash,
      manifest.signature,
      manifest.signedBy,
      manifest.timestamp,
      manifest.ttl,
    ]
  );
  db.close();

  return manifest;
}

async function verifyManifest(
  projectDir: string,
  currentHash: string
): Promise<{ valid: boolean; reason?: string; manifest?: LockfileManifest }> {
  const db = getDb();
  const row = db
    .query("SELECT * FROM manifests WHERE project_path = ?")
    .get(projectDir) as DbManifestRow | null;
  db.close();

  if (!row) {
    return { valid: false, reason: "No manifest found — run 'kimi-guardian sign' to create" };
  }

  const manifest: LockfileManifest = {
    projectPath: row.project_path,
    lockfileHash: row.lockfile_hash,
    signature: row.signature,
    signedBy: row.signed_by,
    timestamp: row.timestamp,
    ttl: row.ttl,
  };

  if (Date.now() > manifest.timestamp + manifest.ttl) {
    return { valid: false, reason: "Manifest expired — re-sign required", manifest };
  }

  if (manifest.lockfileHash !== currentHash) {
    return { valid: false, reason: "Hash mismatch — lockfile changed since signing", manifest };
  }

  const key = await getSigningKey();
  if (!key) {
    return { valid: false, reason: "Signing key missing — cannot verify", manifest };
  }

  const payload = `${projectDir}:${currentHash}:${manifest.timestamp}`;
  const hmac = new Bun.CryptoHasher("sha256");
  hmac.update(key);
  hmac.update(payload);
  const expected = hmac.digest("hex");

  if (expected !== manifest.signature) {
    return { valid: false, reason: "SIGNATURE INVALID — possible tampering", manifest };
  }

  return { valid: true, manifest };
}

async function getSigningKey(): Promise<string | null> {
  try {
    const result = await $`security find-generic-password -s ${KEY_NAME} -w`.nothrow().quiet();
    if (result.exitCode === 0 && result.stdout) {
      return result.stdout.toString().trim();
    }
  } catch {
    // Fallback to file-based key
    const keyPath = join(GUARDIAN_DIR, ".key");
    if (pathExists(keyPath)) {
      return (await Bun.file(keyPath).text()).trim();
    }
  }
  return null;
}

async function createSigningKey(): Promise<string> {
  const key = new Bun.CryptoHasher("sha256").update(randomUUIDv7()).digest("hex");

  try {
    await $`security add-generic-password -s ${KEY_NAME} -a kimi-guardian -w ${key}`
      .nothrow()
      .quiet();
  } catch {
    await Bun.write(join(GUARDIAN_DIR, ".key"), key);
    await $`chmod 600 ${join(GUARDIAN_DIR, ".key")}`.nothrow().quiet();
  }

  return key;
}

interface BunOutdatedEntry {
  current: string;
  latest: string;
}

// ── Lockfile Integrity ───────────────────────────────────────────────

async function checkLockfile(projectDir: string): Promise<GuardianReport["lockfile"]> {
  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");

  if (!pathExists(lockPath)) {
    return { path: lockPath, hash: "", hashMatch: null, stale: false, manifestValid: null };
  }

  const currentHash = await sha256File(lockPath);
  const pkgMtime = pathExists(pkgPath) ? Bun.file(pkgPath).lastModified : 0;
  const lockMtime = Bun.file(lockPath).lastModified;
  const stale = pkgMtime > lockMtime;

  let hashMatch: boolean | null = null;
  if (pathExists(HASH_FILE)) {
    const stored = (await Bun.file(HASH_FILE).text()).trim();
    hashMatch = stored === currentHash;
  }

  const manifestResult = await verifyManifest(projectDir, currentHash);

  return {
    path: lockPath,
    hash: currentHash,
    hashMatch,
    stale,
    manifestValid: manifestResult.valid,
  };
}

async function storeLockfileHash(projectDir: string) {
  const lockPath = join(projectDir, "bun.lock");
  if (!pathExists(lockPath)) return;
  ensureDir(GUARDIAN_DIR);
  const hash = await sha256File(lockPath);
  await Bun.write(HASH_FILE, hash);
  logger.info(`Stored lockfile hash: ${hash.slice(0, 16)}...`);
}

// ── Dependency Drift ─────────────────────────────────────────────────

async function checkOutdated(
  projectDir: string
): Promise<GuardianReport["dependencies"]["outdated"]> {
  try {
    const result = await $`bun outdated --json`.cwd(projectDir).nothrow().quiet();
    if (result.exitCode !== 0 || !result.stdout) return [];

    const data = JSON.parse(result.stdout.toString());
    const outdated: Array<{ name: string; current: string; latest: string }> = [];

    for (const [name, info] of Object.entries(data)) {
      const i = info as BunOutdatedEntry;
      if (i.current !== i.latest) {
        outdated.push({ name, current: i.current, latest: i.latest });
      }
    }
    return outdated;
  } catch {
    return [];
  }
}

async function checkCVEs(
  deps: Array<{ name: string; current: string }>
): Promise<GuardianReport["dependencies"]["cves"]> {
  const cves: GuardianReport["dependencies"]["cves"] = [];

  for (const dep of deps.slice(0, 10)) {
    try {
      const resp = (await fetchWithTimeout(`https://api.osv.dev/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: { name: dep.name, ecosystem: "npm" },
          version: dep.current,
        }),
        timeoutMs: 10000,
      })) as unknown as {
        status: number;
        json(): Promise<{ vulns?: Array<{ id: string; severity?: Array<{ score?: string }> }> }>;
      };
      if (resp.status < 200 || resp.status >= 300) continue;
      const data = await resp.json();
      for (const vuln of data.vulns || []) {
        cves.push({
          name: dep.name,
          cveId: vuln.id,
          severity: vuln.severity?.[0]?.score || "unknown",
        });
      }
    } catch {
      // Network or API error — skip
    }
  }

  return cves;
}

// ── Provenance (P1) ──────────────────────────────────────────────────

async function checkProvenance(
  projectDir: string
): Promise<NonNullable<GuardianReport["provenance"]>> {
  const postinstallScripts: Array<{ pkg: string; script: string }> = [];
  const lowBusFactor: string[] = [];

  const glob = new Bun.Glob("**/package.json");
  const nmPath = join(projectDir, "node_modules");
  if (!pathExists(nmPath)) return { postinstallScripts, lowBusFactor };

  for await (const file of glob.scan({ cwd: nmPath, absolute: true })) {
    try {
      const pkg = (await Bun.file(file).json()) as PackageJson;
      const scripts = pkg.scripts || {};
      const installScript = scripts.postinstall || scripts.preinstall || scripts.install;
      if (installScript) {
        postinstallScripts.push({
          pkg: pkg.name || "unknown",
          script: installScript.slice(0, 100),
        });
      }
    } catch {
      // Skip malformed package.json
    }
  }

  return { postinstallScripts, lowBusFactor };
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(
  projectDir: string
): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // Manifest DB
  let db: Database | null = null;
  try {
    db = getDb();
    checks.push({ name: "manifest-db", status: "ok", message: "Accessible", fixable: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "manifest-db",
      status: "error",
      message: `Cannot open: ${msg}`,
      fixable: false,
    });
    return checks;
  }

  // Signing key
  const key = await getSigningKey();
  checks.push({
    name: "signing-key",
    status: key ? "ok" : "warn",
    message: key ? "Available" : "Missing — run 'kimi-guardian sign' to create",
    fixable: !key,
  });

  // Lockfile
  const lockPath = join(projectDir, "bun.lock");
  checks.push({
    name: "lockfile",
    status: pathExists(lockPath) ? "ok" : "warn",
    message: pathExists(lockPath) ? "present" : "missing",
    fixable: false,
  });

  // Hash baseline
  checks.push({
    name: "hash-baseline",
    status: pathExists(HASH_FILE) ? "ok" : "warn",
    message: pathExists(HASH_FILE) ? "Baselined" : "No baseline — run 'kimi-guardian fix'",
    fixable: !pathExists(HASH_FILE),
  });

  // Manifest count
  const manifestCount = (db.query("SELECT COUNT(*) as c FROM manifests").get() as DbCountRow).c;
  checks.push({
    name: "manifests",
    status: "ok",
    message: `${manifestCount} manifest(s) stored`,
    fixable: false,
  });

  db.close();
  return checks;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "check";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const projectName = await getProjectName(projectDir);

  logger.projectBanner(
    "Kimi Guardian — Supply Chain Security",
    projectDir,
    "v2.0: Signed manifests + Bun.secrets"
  );
  logger.info(`Dir: ${projectDir}`);

  if (command === "sign") {
    logger.section("Sign Lockfile Manifest");
    const lockPath = join(projectDir, "bun.lock");
    if (!pathExists(lockPath)) {
      logger.error("No bun.lock found");
      return 1;
    }
    const hash = await sha256File(lockPath);
    const manifest = await signManifest(projectDir, hash);
    logger.info(`Signed manifest for ${projectName}`);
    logger.info(`Hash: ${manifest.lockfileHash.slice(0, 16)}...`);
    logger.info(`Expires: ${new Date(manifest.timestamp + manifest.ttl).toISOString()}`);
    logger.info("Manifest stored outside repo (first-commit poisoning defense)");
    return 0;
  }

  if (command === "verify") {
    logger.section("Verify Signed Manifest");
    const lockPath = join(projectDir, "bun.lock");
    if (!pathExists(lockPath)) {
      logger.warn("No bun.lock found");
      return 0;
    }
    const hash = await sha256File(lockPath);
    const result = await verifyManifest(projectDir, hash);
    if (result.valid) {
      logger.info("Manifest VALID");
      logger.info(`Signed: ${new Date(result.manifest!.timestamp).toISOString()}`);
    } else {
      logger.error(`Manifest INVALID: ${result.reason}`);
    }
    return result.valid ? 0 : 1;
  }

  if (command === "doctor") {
    const checks = await doctor(projectDir);
    return logger.runDoctor("kimi-guardian", checks);
  }

  logger.section("Lockfile Integrity");
  const lockfile = await checkLockfile(projectDir);
  if (!pathExists(lockfile.path)) {
    logger.warn("No bun.lock found");
  } else {
    logger.info(`Hash: ${lockfile.hash.slice(0, 16)}...`);
    if (lockfile.hashMatch === null) {
      logger.warn("No stored hash — run 'kimi-guardian fix' to baseline");
    } else if (lockfile.hashMatch) {
      logger.info("Hash matches baseline");
    } else {
      logger.error("HASH MISMATCH — lockfile may have been tampered with");
    }
    if (lockfile.manifestValid === null) {
      logger.warn("No signed manifest — run 'kimi-guardian sign' for v2 protection");
    } else if (lockfile.manifestValid) {
      logger.info("Signed manifest VALID (v2)");
    } else {
      logger.error("Signed manifest INVALID — possible tampering (v2)");
    }
    if (lockfile.stale) {
      logger.warn("Lockfile stale (package.json newer)");
    }
  }

  logger.section("Dependency Drift");
  const outdated = await checkOutdated(projectDir);
  if (outdated.length === 0) {
    logger.info("All dependencies up to date");
  } else {
    for (const dep of outdated) {
      logger.warn(`${dep.name}: ${dep.current} → ${dep.latest}`);
    }
  }

  logger.section("CVE Scan");
  const depsForCVE = outdated.map((d) => ({ name: d.name, current: d.current }));
  if (depsForCVE.length === 0) {
    logger.info("No outdated deps to scan");
  } else {
    logger.info(`Scanning ${depsForCVE.length} deps via OSV...`);
    const cves = await checkCVEs(depsForCVE);
    if (cves.length === 0) {
      logger.info("No CVEs found");
    } else {
      for (const cve of cves) {
        logger.error(`${cve.name}: ${cve.cveId} (${cve.severity})`);
      }
    }
  }

  logger.section("Install Policy (bunfig + env)");
  const { auditBunInstallConfig, BUN_DEP_CHANGE_HINT, formatInstallPolicyReport } =
    await import("../lib/bun-install-config.ts");
  const installAudit = await auditBunInstallConfig(projectDir);
  const versionLine = `runtime=${installAudit.versions.runtimeBun} policy≥${installAudit.versions.policyMinBun} packageManager=${installAudit.versions.packageManager ?? "unset"}`;
  logger.info(versionLine);
  if (installAudit.envOverrides.length === 0) {
    logger.info("No BUN_CONFIG_* install overrides in environment");
  } else {
    for (const row of installAudit.envOverrides) {
      const level = row.risky ? "error" : "warn";
      logger[level](`${row.name}=${row.value}`);
    }
  }
  for (const warning of installAudit.warnings) {
    logger.warn(warning);
  }
  if (command === "report") {
    for (const line of formatInstallPolicyReport(installAudit)) {
      logger.info(line);
    }
  }
  if (installAudit.ok && installAudit.bunfigPath) {
    logger.info(`bunfig install policy OK (${installAudit.bunfigPath})`);
    logger.info(BUN_DEP_CHANGE_HINT);
  } else if (!installAudit.ok) {
    logger.warn(`Install policy drift — see ${installAudit.docsUrl}`);
  }

  logger.section("Trusted Dependency Gate");
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) {
    logger.warn("No package.json — skipping trusted dependency check");
  } else {
    const pkg = (await Bun.file(pkgPath).json()) as PackageJson;
    const depCount =
      Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    if (depCount === 0) {
      logger.info("No dependencies — nothing to check");
    } else {
      const { untrusted, legacyBunfigTrusted } = await scanUntrustedInstallScripts(projectDir);
      if (untrusted.length === 0) {
        logger.info("All install scripts trusted");
        if (legacyBunfigTrusted.length > 0) {
          logger.warn(
            "Legacy bunfig.toml trustedDependencies detected — run 'kimi-guardian fix' to migrate to package.json"
          );
        }
      } else {
        for (const dep of untrusted) {
          logger.error(`${dep}: postinstall script NOT in trustedDependencies`);
        }
        logger.warn(trustedDependenciesFixHint(untrusted));
      }
    }
  }

  if (command === "report") {
    logger.section("Provenance (P1)");
    const prov = await checkProvenance(projectDir);
    if (prov.postinstallScripts.length === 0) {
      logger.info("No postinstall scripts found");
    } else {
      logger.warn(`${prov.postinstallScripts.length} postinstall scripts:`);
      for (const s of prov.postinstallScripts.slice(0, 5)) {
        logger.info(`  ${s.pkg}: ${s.script.slice(0, 60)}...`);
      }
    }
  }

  if (command === "fix") {
    logger.section("Fix");
    await storeLockfileHash(projectDir);

    const { untrusted } = await scanUntrustedInstallScripts(projectDir);
    if (untrusted.length > 0) {
      const result = await addTrustedDependencies(projectDir, untrusted);
      logger.info(`Added to package.json trustedDependencies: ${result.added.join(", ")}`);
      if (result.migratedFromBunfig) {
        logger.info("Migrated legacy bunfig.toml trustedDependencies to package.json");
      }
    }

    logger.info("Baselined lockfile hash");
  }

  logger.info(
    "Commands: check (default) | fix (baseline hash + trusted deps) | sign (v2 manifest) | verify (v2 manifest) | report (full P1) | doctor (health check)"
  );
  return 0;
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
    { toolName: "kimi-guardian", logger }
  );
  process.exit(exitCode);
}
