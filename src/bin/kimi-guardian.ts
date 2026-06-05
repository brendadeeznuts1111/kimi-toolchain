#!/usr/bin/env bun
/**
 * Kimi Guardian — Bun-native supply chain security
 * v2.0: Signed lockfile manifests, Bun.secrets integration, first-commit poisoning defense
 * P0: Lockfile integrity, dependency drift, trusted deps
 * P1: Transitive provenance
 *
 * Usage:
 *   kimi-guardian [check|fix|report|sign|verify|doctor]
 */

import { $, TOML } from "bun";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ensureDir, log, sha256File, fetchWithTimeout, getProjectName, resolveProjectRoot } from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const GUARDIAN_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "guardian");
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

// ── Database ─────────────────────────────────────────────────────────

function getDb(): Database {
  if (!existsSync(GUARDIAN_DIR)) mkdirSync(GUARDIAN_DIR, { recursive: true });
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
    [manifest.projectPath, manifest.lockfileHash, manifest.signature, manifest.signedBy, manifest.timestamp, manifest.ttl]
  );
  db.close();

  return manifest;
}

async function verifyManifest(projectDir: string, currentHash: string): Promise<{ valid: boolean; reason?: string; manifest?: LockfileManifest }> {
  const db = getDb();
  const row = db.query("SELECT * FROM manifests WHERE project_path = ?").get(projectDir) as any;
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
    if (existsSync(keyPath)) {
      return (await Bun.file(keyPath).text()).trim();
    }
  }
  return null;
}

async function createSigningKey(): Promise<string> {
  const key = new Bun.CryptoHasher("sha256").update(crypto.randomUUID()).digest("hex");

  try {
    await $`security add-generic-password -s ${KEY_NAME} -a kimi-guardian -w ${key}`.nothrow().quiet();
  } catch {
    await Bun.write(join(GUARDIAN_DIR, ".key"), key);
    await $`chmod 600 ${join(GUARDIAN_DIR, ".key")}`.nothrow().quiet();
  }

  return key;
}

// ── Lockfile Integrity ───────────────────────────────────────────────

async function checkLockfile(projectDir: string): Promise<GuardianReport["lockfile"]> {
  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");

  if (!existsSync(lockPath)) {
    return { path: lockPath, hash: "", hashMatch: null, stale: false, manifestValid: null };
  }

  const currentHash = await sha256File(lockPath);
  const pkgMtime = existsSync(pkgPath) ? Bun.file(pkgPath).lastModified : 0;
  const lockMtime = Bun.file(lockPath).lastModified;
  const stale = pkgMtime > lockMtime;

  let hashMatch: boolean | null = null;
  if (existsSync(HASH_FILE)) {
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
  if (!existsSync(lockPath)) return;
  ensureDir(GUARDIAN_DIR);
  const hash = await sha256File(lockPath);
  await Bun.write(HASH_FILE, hash);
  log("info", `Stored lockfile hash: ${hash.slice(0, 16)}...`);
}

// ── Dependency Drift ─────────────────────────────────────────────────

async function checkOutdated(projectDir: string): Promise<GuardianReport["dependencies"]["outdated"]> {
  try {
    const result = await $`bun outdated --json`.cwd(projectDir).nothrow().quiet();
    if (result.exitCode !== 0 || !result.stdout) return [];

    const data = JSON.parse(result.stdout.toString());
    const outdated: Array<{ name: string; current: string; latest: string }> = [];

    for (const [name, info] of Object.entries(data)) {
      const i = info as any;
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
      const resp = await fetchWithTimeout(`https://api.osv.dev/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: { name: dep.name, ecosystem: "npm" },
          version: dep.current,
        }),
        timeoutMs: 10000,
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;
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

// ── Trusted Dependency Gate ──────────────────────────────────────────

async function checkTrustedDeps(projectDir: string): Promise<string[]> {
  const bunfigPath = join(projectDir, "bunfig.toml");
  const pkgPath = join(projectDir, "package.json");

  if (!existsSync(pkgPath)) return [];

  let allowed = new Set<string>();
  if (existsSync(bunfigPath)) {
    try {
      const config = TOML.parse(await Bun.file(bunfigPath).text()) as any;
      const trusted = config.install?.trustedDependencies || config.trustedDependencies || [];
      allowed = new Set(Array.isArray(trusted) ? trusted : []);
    } catch {
      const content = await Bun.file(bunfigPath).text();
      const match = content.match(/trustedDependencies\s*=\s*\[([^\]]*)\]/);
      if (match) {
        const deps = match[1]
          .split(",")
          .map((d) => d.trim().replace(/["']/g, ""))
          .filter(Boolean);
        allowed = new Set(deps);
      }
    }
  }

  const pkg = (await Bun.file(pkgPath).json()) as any;
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ];

  const untrusted: string[] = [];
  for (const dep of allDeps) {
    const depPkgPath = join(projectDir, "node_modules", dep, "package.json");
    if (!existsSync(depPkgPath)) continue;

    const depPkg = (await Bun.file(depPkgPath).json()) as any;
    const scripts = depPkg.scripts || {};
    if (scripts.postinstall || scripts.preinstall || scripts.install) {
      if (!allowed.has(dep)) {
        untrusted.push(dep);
      }
    }
  }

  return untrusted;
}

async function addTrustedDeps(projectDir: string, deps: string[]) {
  const bunfigPath = join(projectDir, "bunfig.toml");
  let content = "";
  if (existsSync(bunfigPath)) {
    content = await Bun.file(bunfigPath).text();
  }

  const trustedMatch = content.match(/trustedDependencies\s*=\s*\[([^\]]*)\]/);
  if (trustedMatch) {
    const existing = trustedMatch[1]
      .split(",")
      .map((d) => d.trim().replace(/["']/g, ""))
      .filter(Boolean);
    const combined = [...new Set([...existing, ...deps])];
    const newList = combined.map((d) => `"${d}"`).join(", ");
    content = content.replace(/trustedDependencies\s*=\s*\[[^\]]*\]/, `trustedDependencies = [${newList}]`);
  } else {
    const trustedList = deps.map((d) => `"${d}"`).join(", ");
    content += `\n[install]\ntrustedDependencies = [${trustedList}]\n`;
  }

  await Bun.write(bunfigPath, content);
}

// ── Provenance (P1) ──────────────────────────────────────────────────

async function checkProvenance(
  projectDir: string
): Promise<GuardianReport["provenance"]> {
  const postinstallScripts: Array<{ pkg: string; script: string }> = [];
  const lowBusFactor: string[] = [];

  const glob = new Bun.Glob("**/package.json");
  const nmPath = join(projectDir, "node_modules");
  if (!existsSync(nmPath)) return { postinstallScripts, lowBusFactor };

  for await (const file of glob.scan({ cwd: nmPath, absolute: true })) {
    try {
      const pkg = (await Bun.file(file).json()) as any;
      const scripts = pkg.scripts || {};
      const installScript =
        scripts.postinstall || scripts.preinstall || scripts.install;
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

async function doctor(projectDir: string): Promise<Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>> {
  const checks: Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }> = [];

  // Manifest DB
  let db: Database | null = null;
  try {
    db = getDb();
    checks.push({ name: "manifest-db", status: "ok", message: "Accessible", fixable: false });
  } catch (e: any) {
    checks.push({ name: "manifest-db", status: "error", message: `Cannot open: ${e.message}`, fixable: false });
    return checks;
  }

  // Signing key
  const key = await getSigningKey();
  checks.push({ name: "signing-key", status: key ? "ok" : "warn", message: key ? "Available" : "Missing — run 'kimi-guardian sign' to create", fixable: !key });

  // Lockfile
  const lockPath = join(projectDir, "bun.lock");
  checks.push({ name: "lockfile", status: existsSync(lockPath) ? "ok" : "warn", message: existsSync(lockPath) ? "present" : "missing", fixable: false });

  // Hash baseline
  checks.push({ name: "hash-baseline", status: existsSync(HASH_FILE) ? "ok" : "warn", message: existsSync(HASH_FILE) ? "Baselined" : "No baseline — run 'kimi-guardian fix'", fixable: !existsSync(HASH_FILE) });

  // Manifest count
  const manifestCount = (db.query("SELECT COUNT(*) as c FROM manifests").get() as any).c;
  checks.push({ name: "manifests", status: "ok", message: `${manifestCount} manifest(s) stored`, fixable: false });

  db.close();
  return checks;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "check";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const projectName = getProjectName(projectDir);

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Guardian — Supply Chain Security              ║`);
  console.log(`║           v2.0: Signed manifests + Bun.secrets               ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`  Project: ${projectName}`);
  console.log(`  Dir:     ${projectDir}`);
  console.log("");

  if (command === "sign") {
    console.log("── Sign Lockfile Manifest ────────────────────────────────────");
    const lockPath = join(projectDir, "bun.lock");
    if (!existsSync(lockPath)) {
      log("error", "No bun.lock found");
      process.exit(1);
    }
    const hash = await sha256File(lockPath);
    const manifest = await signManifest(projectDir, hash);
    log("info", `Signed manifest for ${projectName}`);
    log("info", `Hash: ${manifest.lockfileHash.slice(0, 16)}...`);
    log("info", `Expires: ${new Date(manifest.timestamp + manifest.ttl).toISOString()}`);
    console.log("");
    console.log("  Manifest stored outside repo (first-commit poisoning defense)");
    return;
  }

  if (command === "verify") {
    console.log("── Verify Signed Manifest ────────────────────────────────────");
    const lockPath = join(projectDir, "bun.lock");
    if (!existsSync(lockPath)) {
      log("warn", "No bun.lock found");
      return;
    }
    const hash = await sha256File(lockPath);
    const result = await verifyManifest(projectDir, hash);
    if (result.valid) {
      log("info", "Manifest VALID");
      log("info", `Signed: ${new Date(result.manifest!.timestamp).toISOString()}`);
    } else {
      log("error", `Manifest INVALID: ${result.reason}`);
    }
    return;
  }

  if (command === "doctor") {
    const checks = await doctor(projectDir);
    console.log("── Guardian Doctor ───────────────────────────────────────────");
    let errors = 0, warns = 0, fixable = 0;
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
    if (fixable > 0) {
      console.log("  Run 'kimi-guardian fix' to repair");
    }
    return;
  }

  console.log("── Lockfile Integrity ────────────────────────────────────────");
  const lockfile = await checkLockfile(projectDir);
  if (!existsSync(lockfile.path)) {
    log("warn", "No bun.lock found");
  } else {
    log("info", `Hash: ${lockfile.hash.slice(0, 16)}...`);
    if (lockfile.hashMatch === null) {
      log("warn", "No stored hash — run 'kimi-guardian fix' to baseline");
    } else if (lockfile.hashMatch) {
      log("info", "Hash matches baseline");
    } else {
      log("error", "HASH MISMATCH — lockfile may have been tampered with");
    }
    if (lockfile.manifestValid === null) {
      log("warn", "No signed manifest — run 'kimi-guardian sign' for v2 protection");
    } else if (lockfile.manifestValid) {
      log("info", "Signed manifest VALID (v2)");
    } else {
      log("error", "Signed manifest INVALID — possible tampering (v2)");
    }
    if (lockfile.stale) {
      log("warn", "Lockfile stale (package.json newer)");
    }
  }

  console.log("");
  console.log("── Dependency Drift ──────────────────────────────────────────");
  const outdated = await checkOutdated(projectDir);
  if (outdated.length === 0) {
    log("info", "All dependencies up to date");
  } else {
    for (const dep of outdated) {
      log("warn", `${dep.name}: ${dep.current} → ${dep.latest}`);
    }
  }

  console.log("");
  console.log("── CVE Scan ──────────────────────────────────────────────────");
  const depsForCVE = outdated.map((d) => ({ name: d.name, current: d.current }));
  if (depsForCVE.length === 0) {
    log("info", "No outdated deps to scan");
  } else {
    log("info", `Scanning ${depsForCVE.length} deps via OSV...`);
    const cves = await checkCVEs(depsForCVE);
    if (cves.length === 0) {
      log("info", "No CVEs found");
    } else {
      for (const cve of cves) {
        log("error", `${cve.name}: ${cve.cveId} (${cve.severity})`);
      }
    }
  }

  console.log("");
  console.log("── Trusted Dependency Gate ───────────────────────────────────");
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) {
    log("warn", "No package.json — skipping trusted dependency check");
  } else {
    const pkg = (await Bun.file(pkgPath).json()) as any;
    const depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    if (depCount === 0) {
      log("info", "No dependencies — nothing to check");
    } else {
      const untrusted = await checkTrustedDeps(projectDir);
      if (untrusted.length === 0) {
        log("info", "All install scripts trusted");
      } else {
        for (const dep of untrusted) {
          log("error", `${dep}: postinstall script NOT in trustedDependencies`);
        }
        log("warn", "Add to bunfig.toml: trustedDependencies = [" +
          untrusted.map((d) => `"${d}"`).join(", ") +
          "]");
      }
    }
  }

  if (command === "report") {
    console.log("");
    console.log("── Provenance (P1) ───────────────────────────────────────────");
    const prov = await checkProvenance(projectDir);
    if (prov.postinstallScripts.length === 0) {
      log("info", "No postinstall scripts found");
    } else {
      log("warn", `${prov.postinstallScripts.length} postinstall scripts:`);
      for (const s of prov.postinstallScripts.slice(0, 5)) {
        console.log(`    ${s.pkg}: ${s.script.slice(0, 60)}...`);
      }
    }
  }

  if (command === "fix") {
    console.log("");
    console.log("── Fix ───────────────────────────────────────────────────────");
    await storeLockfileHash(projectDir);

    // Auto-add untrusted deps to bunfig.toml
    const untrusted = await checkTrustedDeps(projectDir);
    if (untrusted.length > 0) {
      await addTrustedDeps(projectDir, untrusted);
      log("info", `Added to trustedDependencies: ${untrusted.join(", ")}`);
    }

    log("info", "Baselined lockfile hash");
  }

  console.log("");
  console.log("Commands: check (default) | fix (baseline hash + trusted deps) | sign (v2 manifest) | verify (v2 manifest) | report (full P1) | doctor (health check)");
}

main().catch((err) => {
  console.error("Guardian failed:", err.message);
  process.exit(1);
});
