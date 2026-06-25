/**
 * Colored error formatting — reverse-domain labels via Bun.color.
 *
 * @see error-domains-constants.ts — domain SSOT
 * @see inspect.ts — wrapAnsi / sliceAnsi for layout
 */

import {
  ERROR_DOMAIN_BY_ID,
  ERROR_SEVERITY_COLORS,
  TAXONOMY_DOMAIN_HINTS,
  type ErrorDomainId,
  type ErrorSeverity,
} from "./error-domains-constants.ts";

/** @see https://bun.com/docs/runtime/utils#bun-color */
export const BUN_COLOR_DOC_URL = "https://bun.com/docs/runtime/utils#bun-color";

const ANSI_RESET = "\x1b[0m";

export interface FormattedErrorInput {
  /** Reverse-domain string or registered domain id. */
  domain: ErrorDomainId | string;
  message: string;
  severity?: ErrorSeverity;
  /** Short machine code, e.g. jwt_expired. */
  code?: string;
  /** error-taxonomy.yml category id. */
  taxonomyId?: string;
  cause?: string;
}

export interface StructuredErrorRecord {
  schemaVersion: 1;
  domain: string;
  severity: ErrorSeverity;
  message: string;
  code?: string;
  taxonomyId?: string;
  cause?: string;
}

export interface FormattedError {
  plain: string;
  colored: string;
  structured: StructuredErrorRecord;
}

export function colorOutputEnabled(): boolean {
  if (forceColorEnabled()) return true;
  return !noColorActive();
}

/** FORCE_COLOR set to any non-empty value forces color on (overrides NO_COLOR). */
function forceColorEnabled(): boolean {
  const v = Bun.env.FORCE_COLOR;
  return v !== undefined && v !== "0" && v !== "false";
}

/** NO_COLOR (or KIMI_NO_COLOR) set to any non-empty, non-"0", non-"false" value disables color. */
function noColorActive(): boolean {
  for (const key of ["NO_COLOR", "KIMI_NO_COLOR"] as const) {
    const v = Bun.env[key];
    if (v !== undefined && v !== "0" && v !== "false") return true;
  }
  return false;
}

/** Convert a named/hex color to an ANSI 256 foreground prefix. */
export function ansiFg256(color: string): string {
  // Bun.color(_, "ansi-256") returns the full escape sequence (e.g. "\x1b[38;5;196m"), not just the code.
  return Bun.color(color, "ansi-256") ?? "";
}

/** Wrap text in a Bun.color-derived ANSI foreground. */
export function colorize(text: string, namedColor: string): string {
  if (!colorOutputEnabled()) return text;
  const prefix = ansiFg256(namedColor);
  if (!prefix) return text;
  return `${prefix}${text}${ANSI_RESET}`;
}

export function resolveErrorDomain(domainOrId: ErrorDomainId | string): {
  id: ErrorDomainId | null;
  domain: string;
  color: string;
  defaultSeverity: ErrorSeverity;
} {
  const byId = ERROR_DOMAIN_BY_ID[domainOrId as ErrorDomainId];
  if (byId) {
    return {
      id: byId.id as ErrorDomainId,
      domain: byId.domain,
      color: byId.color,
      defaultSeverity: byId.defaultSeverity,
    };
  }
  return {
    id: null,
    domain: domainOrId,
    color: "lightgray",
    defaultSeverity: "error",
  };
}

export function inferDomainFromTaxonomy(taxonomyId: string): ErrorDomainId | undefined {
  return TAXONOMY_DOMAIN_HINTS[taxonomyId];
}

export function formatError(input: FormattedErrorInput): FormattedError {
  const resolved = resolveErrorDomain(input.domain);
  const severity = input.severity ?? resolved.defaultSeverity;
  const domain = resolved.domain;

  const parts: string[] = [];
  if (input.code) parts.push(input.code);
  parts.push(input.message);
  const body = parts.join(": ");

  const meta: string[] = [];
  if (input.taxonomyId) meta.push(`taxonomy=${input.taxonomyId}`);
  if (input.cause) meta.push(`cause=${input.cause}`);
  const metaSuffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";

  const plain = `${domain} · ${severity}: ${body}${metaSuffix}`;

  const domainLabel = colorize(domain, resolved.color);
  const severityLabel = colorize(severity, ERROR_SEVERITY_COLORS[severity]);
  const icon = severity === "fatal" || severity === "error" ? "✗" : severity === "warn" ? "⚠" : "◦";
  const colored = `${icon} ${domainLabel} · ${severityLabel}: ${body}${metaSuffix}`;

  const structured: StructuredErrorRecord = {
    schemaVersion: 1,
    domain,
    severity,
    message: input.message,
    ...(input.code ? { code: input.code } : {}),
    ...(input.taxonomyId ? { taxonomyId: input.taxonomyId } : {}),
    ...(input.cause ? { cause: input.cause } : {}),
  };

  return { plain, colored, structured };
}

/** Plain line suitable for JSONL / agent logs (no ANSI). */
export function formatErrorPlain(input: FormattedErrorInput): string {
  return formatError(input).plain;
}

/** Human CLI line with Bun.color tinting when allowed. */
export function formatErrorColored(input: FormattedErrorInput): string {
  const formatted = formatError(input);
  return colorOutputEnabled() ? formatted.colored : formatted.plain;
}

/** Metadata fields for embedding in mixed success/failure JSON payloads. */
export function structuredErrorFields(
  input: FormattedErrorInput
): Pick<StructuredErrorRecord, "domain" | "severity" | "code" | "taxonomyId"> {
  const { structured } = formatError(input);
  return {
    domain: structured.domain,
    severity: structured.severity,
    ...(structured.code ? { code: structured.code } : {}),
    ...(structured.taxonomyId ? { taxonomyId: structured.taxonomyId } : {}),
  };
}

export interface HttpErrorBody extends StructuredErrorRecord {
  ok: false;
  /** Human message (duplicate of structured.message for legacy clients). */
  error: string;
}

/** JSON-serializable error body for HTTP handlers and MCP tools. */
export function buildHttpErrorBody(
  input: FormattedErrorInput,
  extra?: Record<string, unknown>
): HttpErrorBody {
  const { structured } = formatError(input);
  return {
    ok: false,
    ...structured,
    error: structured.message,
    ...extra,
  };
}

/** Build a JSON Response with structured reverse-domain error fields. */
export function jsonErrorResponse(
  input: FormattedErrorInput,
  status = 400,
  extra?: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(buildHttpErrorBody(input, extra), null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
