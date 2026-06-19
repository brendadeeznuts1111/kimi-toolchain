import { auditUrlI18n, type UrlI18nAudit } from "../lib/url-i18n.ts";
import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface UrlI18nGateResult extends GateResult, UrlI18nAudit {
  timestamp: string;
}

export async function runUrlI18nGate(_opts: GateRunOptions = {}): Promise<GateResult> {
  const audit = auditUrlI18n();
  const result: UrlI18nGateResult = {
    status: audit.ok ? "pass" : "fail",
    reason: audit.ok
      ? undefined
      : `punycode check failed (idempotent=${audit.idempotent}, roundtrip=${audit.roundtrip}, punycodePrefixCorrect=${audit.punycodePrefixCorrect})`,
    ...audit,
    timestamp: new Date().toISOString(),
  };
  return result;
}

export const urlI18nGateDefinition: Gate = {
  name: "url-i18n",
  description: "IDN hostname normalization via punycode.toASCII + url.domainToUnicode",
  level: 1,
  parallel: true,
  run: runUrlI18nGate,
  format: (result) => {
    const row = result as UrlI18nGateResult;
    const lines = [`${row.status}: url-i18n`];
    if (row.reason) lines.push(`       └─ ${row.reason}`);
    lines.push(
      `       └─ probes: ${row.probes?.length ?? 0} domains · idempotent=${row.idempotent}`
    );
    return lines;
  },
};
