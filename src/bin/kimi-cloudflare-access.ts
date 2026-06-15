#!/usr/bin/env bun
/**
 * kimi-cloudflare-access — Cloudflare Access / Zero Trust hygiene
 * P0: Service token expiry sweep
 * P1: Access application policy audit
 * P2: Policy-as-Code (plan/apply via .cloudflare-access.yml)
 *
 * Usage:
 *   kimi-cloudflare-access [tokens|apps|doctor|fix|login|logout|plan|apply]
 *
 * Auth:
 *   1. CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN env vars (CI override)
 *   2. OS keychain via Bun.secrets (set with `kimi-cloudflare-access login`)
 *
 * Note:
 *   Wrangler OAuth tokens and the Kimi Code cloudflare-api MCP server use different
 *   auth flows. This CLI needs a dedicated Cloudflare API token from
 *   https://dash.cloudflare.com/profile/api-tokens.
 */

import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-cloudflare-access");
import {
  applyDiff,
  computeDiff,
  fetchLiveState,
  loadPolicyConfig,
} from "../lib/cloudflare-access-policy.ts";
import {
  AccessApplication,
  apiGet,
  auditApps,
  buildDashboard,
  checkTokenExpiry,
  CREDENTIAL_SERVICE,
  discoverOrphanedResources,
  getCredentials,
  listApplications,
  listServiceTokens,
  rotateServiceToken,
  ServiceToken,
  verifyToken,
} from "../lib/cloudflare-access.ts";

// ── Config ───────────────────────────────────────────────────────────

const DEFAULT_WARN_DAYS = 30;

// ── Credentials ──────────────────────────────────────────────────────

async function login(): Promise<number> {
  const accountId = prompt("Cloudflare Account ID:")?.trim();
  const apiToken = prompt("Cloudflare API Token:")?.trim();

  if (!accountId || !apiToken) {
    logger.error("Account ID and API token are required.");
    return 1;
  }

  Bun.stdout.write("Verifying token...");
  const verification = await verifyToken(apiToken);
  if (!verification.valid) {
    console.log(" failed");
    logger.error(`Token verification failed: ${verification.message}`);
    return 1;
  }
  console.log(" ok");

  await Bun.secrets.set({
    service: CREDENTIAL_SERVICE,
    name: "cloudflare-account-id",
    value: accountId,
  });
  await Bun.secrets.set({
    service: CREDENTIAL_SERVICE,
    name: "cloudflare-api-token",
    value: apiToken,
  });

  logger.info("Credentials saved to OS keychain.");
  logger.info("Run `kimi-cloudflare-access logout` to remove them.");
  return 0;
}

async function logout(): Promise<number> {
  await Bun.secrets.delete({ service: CREDENTIAL_SERVICE, name: "cloudflare-account-id" });
  await Bun.secrets.delete({ service: CREDENTIAL_SERVICE, name: "cloudflare-api-token" });
  logger.info("Cloudflare credentials removed from OS keychain.");
  return 0;
}

// ── API ──────────────────────────────────────────────────────────────

/* Unused helpers kept for future auth-error handling:
function isAuthError(err: unknown): boolean {
  return err instanceof Error && /\b40[13]\b|Authentication error/.test(err.message);
}

function printAuthHelp() {
  log(
    "error",
    "API token lacks Access permissions. Ensure the token has Account > Access: Read (and Access: Edit to rotate tokens)."
  );
  logger.info("Create or verify tokens at https://dash.cloudflare.com/profile/api-tokens");
}
*/

// ── Token Violation Sweep ────────────────────────────────────────────

function printViolations(violations: import("../lib/cloudflare-access.ts").TokenViolation[]) {
  if (violations.length === 0) {
    logger.info("No service token expiry issues");
    return;
  }

  for (const v of violations) {
    const label = v.token.name || v.token.client_id || v.token.id;
    if (v.reason === "expired") {
      logger.error(`${label}: expired ${Math.abs(v.daysRemaining || 0)} day(s) ago`);
    } else if (v.reason === "expiring-soon") {
      logger.warn(`${label}: expires in ${v.daysRemaining} day(s)`);
    } else {
      logger.warn(`${label}: no expiry set`);
    }
  }
}

// ── App Policy Audit ─────────────────────────────────────────────────

function printAppFindings(findings: import("../lib/cloudflare-access.ts").AppFinding[]) {
  if (findings.length === 0) {
    logger.info("No Access application policy issues");
    return;
  }

  const byApp = new Map<string, import("../lib/cloudflare-access.ts").AppFinding[]>();
  for (const f of findings) {
    const list = byApp.get(f.app.name) || [];
    list.push(f);
    byApp.set(f.app.name, list);
  }

  for (const [appName, list] of byApp) {
    console.log(`  ${appName}`);
    for (const f of list) {
      const icon =
        f.reason === "bypass"
          ? "✗"
          : f.reason === "allow-everyone" || f.reason === "missing-mfa"
            ? "⚠"
            : "⚠";
      console.log(`    ${icon} ${f.detail}`);
    }
  }
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  let accountId: string;
  let apiToken: string;

  try {
    const creds = await getCredentials();
    accountId = creds.accountId;
    apiToken = creds.apiToken;
    checks.push({
      name: "cloudflare-credentials",
      status: "ok",
      message: "Cloudflare credentials resolved",
      fixable: false,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "cloudflare-credentials",
      status: "error",
      message: msg.replace(/\n/g, " "),
      fixable: false,
    });
    return checks;
  }

  let tokens: ServiceToken[] = [];
  try {
    tokens = await listServiceTokens(accountId, apiToken);
    checks.push({
      name: "service-tokens-api",
      status: "ok",
      message: `Listed ${tokens.length} service token(s)`,
      fixable: false,
    });

    const violations = checkTokenExpiry(tokens);
    const expired = violations.filter((v) => v.reason === "expired").length;
    const expiring = violations.filter((v) => v.reason === "expiring-soon").length;
    const noExpiry = violations.filter((v) => v.reason === "no-expiry").length;

    if (expired > 0) {
      checks.push({
        name: "service-tokens-expired",
        status: "error",
        message: `${expired} token(s) expired`,
        fixable: true,
      });
    }
    if (expiring > 0) {
      checks.push({
        name: "service-tokens-expiring",
        status: "warn",
        message: `${expiring} token(s) expire within ${DEFAULT_WARN_DAYS} days`,
        fixable: true,
      });
    }
    if (noExpiry > 0) {
      checks.push({
        name: "service-tokens-no-expiry",
        status: "warn",
        message: `${noExpiry} token(s) have no expiry`,
        fixable: false,
      });
    }

    if (expired === 0 && expiring === 0 && noExpiry === 0) {
      checks.push({
        name: "service-tokens-expiry",
        status: "ok",
        message: "All service tokens have healthy expiry",
        fixable: false,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "service-tokens-api",
      status: "error",
      message: `API call failed: ${msg}`,
      fixable: false,
    });
  }

  try {
    const apps = await listApplications(accountId, apiToken);
    checks.push({
      name: "access-apps-api",
      status: "ok",
      message: `Listed ${apps.length} Access application(s)`,
      fixable: false,
    });

    const findings = auditApps(apps, tokens);
    const bypass = findings.filter((f) => f.reason === "bypass").length;
    const allowEveryone = findings.filter((f) => f.reason === "allow-everyone").length;
    const missingMfa = findings.filter((f) => f.reason === "missing-mfa").length;
    const longSession = findings.filter((f) => f.reason === "long-session").length;
    const noIdp = findings.filter((f) => f.reason === "no-idp-restriction").length;
    const sharedToken = findings.filter((f) => f.reason === "shared-service-token").length;
    const redundantToken = findings.filter((f) => f.reason === "redundant-service-token").length;

    if (bypass > 0) {
      checks.push({
        name: "access-apps-bypass",
        status: "error",
        message: `${bypass} bypass policy(ies) found`,
        fixable: false,
      });
    }
    if (allowEveryone > 0) {
      checks.push({
        name: "access-apps-allow-everyone",
        status: "warn",
        message: `${allowEveryone} "allow everyone" policy(ies) found`,
        fixable: false,
      });
    }
    if (missingMfa > 0) {
      checks.push({
        name: "access-apps-missing-mfa",
        status: "warn",
        message: `${missingMfa} allow policy(ies) do not require MFA`,
        fixable: false,
      });
    }
    if (longSession > 0) {
      checks.push({
        name: "access-apps-long-session",
        status: "warn",
        message: `${longSession} app(s) with session > 7 days`,
        fixable: false,
      });
    }
    if (noIdp > 0) {
      checks.push({
        name: "access-apps-no-idp-restriction",
        status: "warn",
        message: `${noIdp} app(s) without IdP restriction`,
        fixable: false,
      });
    }
    if (sharedToken > 0) {
      checks.push({
        name: "access-apps-shared-service-token",
        status: "warn",
        message: `${sharedToken} app/policy use(s) of shared service token`,
        fixable: false,
      });
    }
    if (redundantToken > 0) {
      checks.push({
        name: "access-apps-redundant-service-token",
        status: "warn",
        message: `${redundantToken} policy(ies) with redundant service token (everyone already allowed)`,
        fixable: false,
      });
    }

    if (
      bypass === 0 &&
      allowEveryone === 0 &&
      missingMfa === 0 &&
      longSession === 0 &&
      noIdp === 0 &&
      sharedToken === 0 &&
      redundantToken === 0
    ) {
      checks.push({
        name: "access-apps-policy",
        status: "ok",
        message: "All Access applications pass policy audit",
        fixable: false,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "access-apps-api",
      status: "error",
      message: `API call failed: ${msg}`,
      fixable: false,
    });
  }

  return checks;
}

// ── Dashboard ────────────────────────────────────────────────────────

function printDashboard(mappings: import("../lib/cloudflare-access.ts").ProjectMapping[]) {
  logger.section("Cloudflare SSO Project Dashboard");

  const byStatus = { ok: 0, warn: 0, error: 0, info: 0 };
  for (const m of mappings) byStatus[m.status]++;

  console.log(
    `  Apps: ${mappings.length}  ✓ ${byStatus.ok}  ⚠ ${byStatus.warn}  ✗ ${byStatus.error}  ℹ ${byStatus.info}`
  );
  console.log("");

  for (const m of mappings) {
    const icon =
      m.status === "ok" ? "✓" : m.status === "warn" ? "⚠" : m.status === "error" ? "✗" : "ℹ";
    console.log(`  ${icon} ${m.appName}  (${m.appType})`);
    if (m.domain) console.log(`     Domain: ${m.domain}`);
    if (m.localPath) {
      console.log(`     Local:  ${m.localPath}`);
      const pkgLine = [
        m.packageName && `pkg: ${m.packageName}`,
        m.packageVersion && `v${m.packageVersion}`,
      ]
        .filter(Boolean)
        .join(" ");
      if (pkgLine) console.log(`     ${pkgLine}`);
      if (m.repoUrl) console.log(`     Repo:   ${m.repoUrl}`);
      console.log(
        `     Config: wrangler=${m.hasWranglerConfig ? "yes" : "no"} access=${m.hasAccessConfig ? "yes" : "no"}`
      );
    } else {
      console.log(`     Local:  (not found)`);
    }
    console.log(
      `     Policies: ${m.policyCount}  Bypass: ${m.bypassCount}  Allow-everyone: ${m.allowEveryoneCount}`
    );
    // Infrastructure bindings
    const infraParts: string[] = [];
    if (m.workerName) infraParts.push(`Worker: ${m.workerName}`);
    if (m.workerRoute) infraParts.push(`Route: ${m.workerRoute}`);
    if (m.r2Buckets?.length) infraParts.push(`R2: ${m.r2Buckets.join(", ")}`);
    if (m.d1Databases?.length) infraParts.push(`D1: ${m.d1Databases.join(", ")}`);
    if (m.kvNamespaces?.length) infraParts.push(`KV: ${m.kvNamespaces.join(", ")}`);
    if (infraParts.length) {
      console.log(`     Infra:  ${infraParts.join("  |  ")}`);
    }
    for (const note of m.notes) {
      console.log(`     → ${note}`);
    }
    console.log("");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const rawArgs = Bun.argv.slice(2);
  const jsonMode = rawArgs.includes("--json");
  const args = rawArgs.filter((a) => a !== "--json");
  const command = args[0] || "tokens";

  function jsonOut(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
  }

  if (!jsonMode) {
    logger.banner("Kimi Cloudflare Access — Zero Trust Hygiene");
  }

  if (command === "login") {
    return await login();
  }

  if (command === "logout") {
    return await logout();
  }

  if (command === "doctor") {
    const checks = await doctor();
    if (jsonMode) {
      const errors = checks.filter((c) => c.status === "error").length;
      const warnings = checks.filter((c) => c.status === "warn").length;
      const fixable = checks.filter((c) => c.fixable).length;
      jsonOut({
        checks,
        summary: { errors, warnings, fixable },
      });
      return errors > 0 ? 1 : 0;
    }
    logger.section("Cloudflare Access Doctor");
    let errors = 0;
    for (const c of checks) {
      logger.check(c);
      if (c.status === "error") errors++;
    }
    const warns = checks.filter((c) => c.status === "warn").length;
    const fixable = checks.filter((c) => c.fixable).length;
    logger.info(`${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
    return errors > 0 ? 1 : 0;
  }

  let accountId: string;
  let apiToken: string;
  try {
    ({ accountId, apiToken } = await getCredentials());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (jsonMode) {
      jsonOut({ error: msg });
    } else {
      logger.error(msg);
    }
    return 1;
  }

  if (command === "tokens") {
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(`Failed to list service tokens: ${msg}`);
      }
      return 1;
    }
    const violations = checkTokenExpiry(tokens);
    if (jsonMode) {
      jsonOut({ tokens, violations });
      return violations.some((v) => v.reason === "expired") ? 1 : 0;
    }
    logger.section("Service Token Expiry Sweep");
    logger.info(`Found ${tokens.length} service token(s)`);
    printViolations(violations);
    logger.info("Commands: tokens (default) | apps | doctor | fix | login | logout | dashboard");
    return violations.some((v) => v.reason === "expired") ? 1 : 0;
  }

  if (command === "dashboard") {
    let apps: AccessApplication[];
    let tokens: ServiceToken[];
    try {
      [apps, tokens] = await Promise.all([
        listApplications(accountId, apiToken),
        listServiceTokens(accountId, apiToken),
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(`Failed to fetch Access data: ${msg}`);
      }
      return 1;
    }
    const mappings = await buildDashboard(apps, tokens);
    const orphaned = await discoverOrphanedResources(accountId, apiToken);
    const errors = mappings.filter((m) => m.status === "error").length;
    const warnings = mappings.filter((m) => m.status === "warn").length;
    const unmapped = mappings.filter((m) => !m.localPath).length;
    if (jsonMode) {
      jsonOut({
        mappings,
        orphaned,
        summary: {
          total: mappings.length,
          errors,
          warnings,
          unmapped,
          mappedWithAccessConfig: mappings.filter((m) => m.hasAccessConfig).length,
          mappedWithWrangler: mappings.filter((m) => m.hasWranglerConfig).length,
          orphanedResources: orphaned.length,
        },
      });
      return errors > 0 ? 1 : 0;
    }
    printDashboard(mappings);
    if (orphaned.length > 0) {
      logger.section("Orphaned Resources");
      for (const o of orphaned) {
        const icon = o.type === "r2_bucket" ? "🪣" : "📦";
        console.log(`  ${icon} ${o.name} (${o.type})`);
        console.log(`     → ${o.detail}`);
        console.log(`     → Suggested: ${o.suggestedAction}`);
      }
      console.log("");
    }
    logger.info(`${errors} error(s), ${warnings} warning(s), ${unmapped} unmapped`);
    if (orphaned.length > 0) {
      logger.warn(`${orphaned.length} orphaned resource(s) detected`);
    }
    return errors > 0 ? 1 : 0;
  }

  if (command === "apps") {
    let apps: AccessApplication[];
    let tokens: ServiceToken[];
    try {
      [apps, tokens] = await Promise.all([
        listApplications(accountId, apiToken),
        listServiceTokens(accountId, apiToken),
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(`Failed to fetch Access data: ${msg}`);
      }
      return 1;
    }
    const findings = auditApps(apps, tokens);
    if (jsonMode) {
      jsonOut({ apps, tokens, findings });
      return findings.some((f) => f.reason === "bypass") ? 1 : 0;
    }
    logger.section("Access Application Policy Audit");
    logger.info(`Found ${apps.length} application(s), ${tokens.length} service token(s)`);
    printAppFindings(findings);
    logger.info("Commands: tokens (default) | apps | doctor | fix | login | logout | dashboard");
    return findings.some((f) => f.reason === "bypass") ? 1 : 0;
  }

  if (command === "fix") {
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(`Failed to list service tokens: ${msg}`);
      }
      return 1;
    }
    const violations = checkTokenExpiry(tokens);
    const rotatable = violations.filter(
      (v) => v.reason === "expired" || v.reason === "expiring-soon"
    );

    if (rotatable.length === 0) {
      if (jsonMode) {
        jsonOut({ rotated: [], failures: [] });
      } else {
        logger.info("No expired or expiring tokens to rotate");
      }
      return 0;
    }

    const rotated: Array<{ token: ServiceToken; client_id: string; client_secret: string }> = [];
    const failures: Array<{ token: ServiceToken; error: string }> = [];
    for (const v of rotatable) {
      const label = v.token.name || v.token.client_id || v.token.id;
      try {
        const result = await rotateServiceToken(accountId, apiToken, v.token.id);
        rotated.push({
          token: v.token,
          client_id: result.client_id,
          client_secret: result.client_secret,
        });
        if (!jsonMode) {
          logger.info(`Rotated ${label}`);
          console.log(`    new client_id: ${result.client_id}`);
          console.log(
            `    new client_secret: ${result.client_secret.slice(0, 8)}... (store securely)`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ token: v.token, error: msg });
        if (!jsonMode) {
          logger.error(`Failed to rotate ${label}: ${msg}`);
        }
      }
    }
    if (jsonMode) {
      jsonOut({ rotated, failures });
    }
    return failures.length > 0 ? 1 : 0;
  }

  if (command === "plan" || command === "apply") {
    const config = await loadPolicyConfig(process.cwd());
    if (!config) {
      const msg = "No .cloudflare-access.yml found in current directory";
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(msg);
      }
      return 1;
    }

    let live;
    try {
      live = await fetchLiveState(accountId, apiToken);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(`Failed to fetch live state: ${msg}`);
      }
      return 1;
    }

    const diff = computeDiff(config, live);
    const hasChanges = diff.some((d) => d.action !== "noop");

    if (command === "plan") {
      if (jsonMode) {
        jsonOut({ config, live, diff, hasChanges });
      } else {
        logger.section("Policy-as-Code Plan");
        if (!hasChanges) {
          logger.info("No changes — live state matches desired state");
        } else {
          for (const d of diff) {
            if (d.action === "noop") continue;
            const icon = d.action === "create" ? "+" : d.action === "delete" ? "-" : "~";
            console.log(`  ${icon} ${d.appName} (${d.action})`);
            if (d.appChanges) {
              for (const c of d.appChanges) console.log(`      app: ${c}`);
            }
            if (d.policyChanges) {
              for (const pc of d.policyChanges) {
                if (pc.action === "noop") continue;
                const picon = pc.action === "create" ? "+" : pc.action === "delete" ? "-" : "~";
                console.log(`      ${picon} policy: ${pc.policyName} (${pc.action})`);
                if (pc.changes) {
                  for (const c of pc.changes) console.log(`          ${c}`);
                }
              }
            }
          }
        }
        logger.info('Run "kimi-cloudflare-access apply" to apply changes');
      }
      return hasChanges ? 1 : 0;
    }

    if (command === "apply") {
      const dryRun = args.includes("--dry-run");
      if (!dryRun && !hasChanges) {
        if (jsonMode) {
          jsonOut({ applied: false, reason: "no changes" });
        } else {
          logger.info("No changes to apply");
        }
        return 0;
      }

      if (!dryRun && !jsonMode) {
        const confirm = prompt(
          `Apply ${diff.filter((d) => d.action !== "noop").length} change(s)? [y/N] `
        );
        if (confirm?.trim().toLowerCase() !== "y") {
          logger.info("Aborted");
          return 0;
        }
      }

      const result = await applyDiff(accountId, apiToken, diff, config, live, dryRun);
      if (jsonMode) {
        jsonOut({ dryRun, ...result });
      } else {
        logger.section(dryRun ? "Apply (dry-run)" : "Apply");
        logger.info(
          `Created: ${result.created}, Updated: ${result.updated}, Deleted: ${result.deleted}`
        );
        if (result.errors.length > 0) {
          for (const e of result.errors) logger.error(e);
        }
      }
      return result.errors.length > 0 ? 1 : 0;
    }
  }

  if (command === "mcp-apply") {
    const config = await loadPolicyConfig(process.cwd());
    if (!config) {
      const msg = "No .cloudflare-access.yml found in current directory";
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(msg);
      }
      return 1;
    }

    let mcpAccountId: string;
    try {
      ({ accountId: mcpAccountId } = await getCredentials());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        logger.error(msg);
      }
      return 1;
    }

    // Build MCP script for policy updates
    const policyUpdates: Array<{
      appId: string;
      policyId: string;
      appName: string;
      policyName: string;
      body: unknown;
    }> = [];

    for (const app of config.apps) {
      if (!app.policies || app.policies.length === 0) continue;
      // We need live IDs — fetch them
      try {
        const liveApps =
          (await apiGet<
            Array<{
              id: string;
              name: string;
              policies: Array<{ id: string; name: string; reusable?: boolean }>;
            }>
          >(mcpAccountId, apiToken, "/access/apps")) || [];
        const liveApp = liveApps.find((a) => a.name === app.name);
        if (!liveApp) {
          if (!jsonMode) logger.warn(`App "${app.name}" not found live — skipping`);
          continue;
        }
        for (const desiredPolicy of app.policies) {
          const livePolicy = liveApp.policies.find((p) => p.name === desiredPolicy.name);
          if (livePolicy) {
            policyUpdates.push({
              appId: liveApp.id,
              policyId: livePolicy.id,
              appName: app.name,
              policyName: desiredPolicy.name,
              body: {
                name: desiredPolicy.name,
                decision: desiredPolicy.decision,
                include: desiredPolicy.include,
                exclude: desiredPolicy.exclude || [],
                require: desiredPolicy.require || [],
              },
            });
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!jsonMode) logger.error(`Failed to fetch live state for ${app.name}: ${msg}`);
      }
    }

    if (policyUpdates.length === 0) {
      if (!jsonMode) logger.info("No matching live policies to update");
      return 0;
    }

    // Generate MCP script
    const mcpScript = `// Run this via MCP cloudflare-api server
// Generated by kimi-cloudflare-access mcp-apply
async () => {
  const accountId = "${mcpAccountId}";
  const updates = ${JSON.stringify(policyUpdates, null, 2)};
  const results = [];
  for (const u of updates) {
    const resp = await cloudflare.request({
      method: "PUT",
      path: \`/accounts/\${accountId}/access/apps/\${u.appId}/policies/\${u.policyId}\`,
      body: u.body,
    });
    results.push({ app: u.appName, policy: u.policyName, status: resp.status, success: resp.success, errors: resp.errors });
  }
  return results;
}`;

    if (jsonMode) {
      jsonOut({ policyUpdates, mcpScript });
    } else {
      logger.section("MCP Apply Script");
      console.log("  Copy the script below and run via MCP cloudflare-api:");
      console.log("");
      console.log(mcpScript);
      console.log("");
      logger.info(`${policyUpdates.length} policy update(s) ready`);
    }
    return 0;
  }

  logger.error(`Unknown command: ${command}`);
  logger.info(
    "Usage: kimi-cloudflare-access [tokens|apps|doctor|fix|login|logout|plan|apply|dashboard|mcp-apply]"
  );
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
    { toolName: "kimi-cloudflare-access" }
  );
  process.exit(exitCode);
}
