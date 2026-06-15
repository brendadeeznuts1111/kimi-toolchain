/**
 * GitHub PR check classification — treat Actions billing lockouts as ignorable.
 * Local Bun CI (`bun run ci:local`) is the merge gate when Actions is unavailable.
 */

export type PrCheckDisposition = "required" | "informational" | "ignored";

export interface PrCheckSummary {
  name: string;
  conclusion: string | null;
  disposition: PrCheckDisposition;
  ignoreReason?: string;
  detailsUrl?: string;
  message?: string;
}

export interface PrChecksReport {
  mergeGate: "local-ci";
  actionsAvailable: boolean;
  requiredPassing: boolean;
  ignored: PrCheckSummary[];
  informational: PrCheckSummary[];
  blocking: PrCheckSummary[];
  message: string;
}

const BILLING_PATTERNS = [
  /account is locked due to a billing issue/i,
  /job was not started because your account is locked/i,
  /billing issue/i,
  /spending limit/i,
  /payment method/i,
] as const;

const INFORMATIONAL_CHECK_NAMES = new Set([
  "coderabbit",
  "socket security: project report",
  "socket security: pull request alerts",
]);

/** GitHub Actions jobs replaced by `bun run ci:local` when Actions billing is unavailable. */
const LOCAL_CI_ACTION_JOBS = new Set(["quality", "governance"]);

export function isActionsBillingFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return BILLING_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeCheckName(name: string): string {
  return name.trim().toLowerCase();
}

export function classifyPrCheck(input: {
  name: string;
  conclusion?: string | null;
  message?: string | null;
}): PrCheckSummary {
  const name = input.name.trim();
  const conclusion = input.conclusion ?? null;
  const message = input.message ?? null;
  const normalized = normalizeCheckName(name);

  if (isActionsBillingFailure(message)) {
    return {
      name,
      conclusion,
      disposition: "ignored",
      ignoreReason: "actions-billing",
    };
  }

  if (LOCAL_CI_ACTION_JOBS.has(normalized)) {
    return {
      name,
      conclusion,
      disposition: "ignored",
      ignoreReason: "use-local-ci",
    };
  }

  if (INFORMATIONAL_CHECK_NAMES.has(normalized)) {
    return { name, conclusion, disposition: "informational" };
  }

  if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
    return { name, conclusion, disposition: "informational" };
  }

  if (conclusion === "FAILURE") {
    return { name, conclusion, disposition: "required", message: message ?? undefined };
  }

  return { name, conclusion, disposition: "informational" };
}

export function summarizePrChecks(
  checks: Array<{
    name: string;
    conclusion?: string | null;
    detailsUrl?: string;
    output?: { title?: string; summary?: string } | null;
  }>,
  options: { localCiPassing?: boolean | null } = {}
): PrChecksReport {
  const classified = checks.map((check) => {
    const message = check.output?.summary ?? check.output?.title ?? null;
    const summary = classifyPrCheck({
      name: check.name,
      conclusion: check.conclusion ?? null,
      message,
    });
    if (check.detailsUrl) summary.detailsUrl = check.detailsUrl;
    return summary;
  });

  const ignored = classified.filter((check) => check.disposition === "ignored");
  const informational = classified.filter((check) => check.disposition === "informational");
  const blocking = classified.filter((check) => check.disposition === "required");

  const actionsBilling = ignored.some((check) => check.ignoreReason === "actions-billing");
  const usesLocalCi = ignored.some((check) => check.ignoreReason === "use-local-ci");
  const actionsAvailable = !actionsBilling && !usesLocalCi && blocking.length === 0;

  const localCiPassing = options.localCiPassing;
  const localCiChecked = localCiPassing === true || localCiPassing === false;
  const requiredPassing =
    (localCiChecked ? localCiPassing === true : blocking.length === 0) && blocking.length === 0;

  let message: string;
  if (requiredPassing && localCiChecked) {
    message =
      actionsBilling || usesLocalCi
        ? "Local CI passing; GitHub Actions quality/governance ignored (use local CI)."
        : "Local CI passing.";
  } else if (requiredPassing && !localCiChecked) {
    message =
      actionsBilling || usesLocalCi
        ? "Remote checks OK (Actions quality/governance ignored); run: bun run ci:local before merge."
        : "Remote checks OK; run: bun run ci:local before merge.";
  } else if (localCiChecked && localCiPassing === false) {
    message = "Local CI failing — run: bun run ci:local";
  } else {
    message = `Blocking remote checks: ${blocking.map((check) => check.name).join(", ")}`;
  }

  return {
    mergeGate: "local-ci",
    actionsAvailable,
    requiredPassing,
    ignored,
    informational,
    blocking,
    message,
  };
}

export function parseGhStatusCheckRollup(
  rollup: Array<{
    name?: string;
    conclusion?: string | null;
    detailsUrl?: string;
    status?: string;
  }>
): Array<{ name: string; conclusion: string | null; detailsUrl?: string }> {
  return rollup
    .filter(
      (item): item is { name: string; conclusion?: string | null; detailsUrl?: string } =>
        typeof item.name === "string"
    )
    .map((item) => ({
      name: item.name,
      conclusion: item.conclusion ?? null,
      detailsUrl: item.detailsUrl,
    }));
}
