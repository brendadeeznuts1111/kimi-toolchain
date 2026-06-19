/**
 * email-i18n gate — L1 structural probes for internationalized email addresses.
 *
 * CLI: `kimi-doctor --gate email-i18n` · registry: `getGate("email-i18n")`
 * Audit logic: `src/lib/email-i18n.ts` (`auditEmailI18n`, `EMAIL_I18N_FIXTURES`)
 *
 * **Limitations (intentional — not a mail parser):**
 * - No full RFC 6531 / RFC 5322 parsing
 * - NFC normalization on local part only (not NFD/NFKC)
 * - No quoted-string or comment handling
 * - IDN domain via punycode.toASCII + url.domainToUnicode (shared with url-i18n)
 *
 * Artifact-lineage canvas placement deferred until real usage justifies it.
 */
import { auditEmailI18n, type EmailI18nAudit } from "../lib/email-i18n.ts";
import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface EmailI18nGateResult extends GateResult, EmailI18nAudit {
  timestamp: string;
}

export async function runEmailI18nGate(_opts: GateRunOptions = {}): Promise<GateResult> {
  const audit = auditEmailI18n();
  const result: EmailI18nGateResult = {
    status: audit.ok ? "pass" : "fail",
    reason: audit.ok
      ? undefined
      : `email-i18n: ${audit.summary.failed}/${audit.summary.total} probes mismatched expectation`,
    ...audit,
    timestamp: new Date().toISOString(),
  };
  return result;
}

export const emailI18nGateDefinition: Gate = {
  name: "email-i18n",
  description:
    "Internationalized email probes — @ split, UTF-8 octet limits, IDN domain via punycode + domainToUnicode",
  level: 1,
  parallel: true,
  run: runEmailI18nGate,
  format: (result) => {
    const row = result as EmailI18nGateResult;
    const lines = [`${row.status}: email-i18n`];
    if (row.reason) lines.push(`       └─ ${row.reason}`);
    lines.push(
      `       └─ probes: ${row.summary?.passed ?? 0}/${row.summary?.total ?? 0} ok · lengthValid=${row.lengthValid} · domainIdempotent=${row.domainIdempotent}`
    );
    return lines;
  },
};
