import { describe, expect, test } from "bun:test";
import { ERROR_DOMAIN_DEFINITIONS } from "../src/lib/error-domains-constants.ts";
import {
  buildHttpErrorBody,
  colorOutputEnabled,
  colorize,
  formatError,
  formatErrorColored,
  formatErrorPlain,
  inferDomainFromTaxonomy,
  jsonErrorResponse,
  resolveErrorDomain,
  structuredErrorFields,
  stripFormattedError,
} from "../src/lib/error-format.ts";
import { lintErrorRegistry } from "../src/lib/error-registry-lint.ts";
import { Logger } from "../src/lib/logger.ts";
import { REPO_ROOT, withClearedEnv, withEnv, captureConsoleError } from "./helpers.ts";

describe("error-format", () => {
  test("ERROR_DOMAIN_DEFINITIONS ids are unique", () => {
    const ids = ERROR_DOMAIN_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("resolveErrorDomain resolves registered ids", () => {
    const resolved = resolveErrorDomain("identity-jwt");
    expect(resolved.domain).toBe("com.kimi.toolchain.identity.jwt");
    expect(resolved.color).toBe("lightseagreen");
  });

  test("resolveErrorDomain passes through raw reverse-domain strings", () => {
    const resolved = resolveErrorDomain("com.example.custom");
    expect(resolved.domain).toBe("com.example.custom");
    expect(resolved.id).toBeNull();
  });

  test("formatErrorPlain builds searchable reverse-domain line", () => {
    const plain = formatErrorPlain({
      domain: "gates",
      code: "effect_gates",
      message: "runPromise boundary violated",
      taxonomyId: "effect_gates_failure",
    });
    expect(plain).toContain("com.kimi.toolchain.gates");
    expect(plain).toContain("effect_gates:");
    expect(plain).toContain("taxonomy=effect_gates_failure");
  });

  test("formatError colored includes ANSI when color enabled", () => {
    withClearedEnv(["NO_COLOR", "KIMI_NO_COLOR"], () => {
      const formatted = formatError({
        domain: "cli",
        severity: "error",
        message: "invalid flag",
      });
      expect(formatted.plain).not.toContain("\x1b[");
      if (colorOutputEnabled()) {
        expect(formatted.colored).toContain("\x1b[");
        expect(stripFormattedError(formatted.colored)).toContain("com.kimi.toolchain.cli");
      }
    });
  });

  test("stripFormattedError removes ANSI codes", () => {
    const colored = colorize("probe", "red");
    expect(stripFormattedError(colored)).toBe("probe");
  });

  test("colorize respects NO_COLOR", () => {
    withEnv({ NO_COLOR: "1" }, () => {
      expect(colorize("hello", "red")).toBe("hello");
    });
  });

  test("colorize respects NO_COLOR=true (not just 1)", () => {
    withClearedEnv(["FORCE_COLOR"], () => {
      withEnv({ NO_COLOR: "true" }, () => {
        expect(colorOutputEnabled()).toBe(false);
        expect(colorize("hello", "red")).toBe("hello");
      });
    });
  });

  test("FORCE_COLOR overrides NO_COLOR", () => {
    withEnv({ NO_COLOR: "1", FORCE_COLOR: "1" }, () => {
      expect(colorOutputEnabled()).toBe(true);
      expect(colorize("hello", "red")).not.toBe("hello");
    });
  });

  test("FORCE_COLOR=0 does not force color", () => {
    withEnv({ NO_COLOR: "1", FORCE_COLOR: "0" }, () => {
      expect(colorOutputEnabled()).toBe(false);
      expect(colorize("hello", "red")).toBe("hello");
    });
  });

  test("inferDomainFromTaxonomy maps known taxonomy ids", () => {
    expect(inferDomainFromTaxonomy("lint_failure")).toBe("cli");
    expect(inferDomainFromTaxonomy("unknown_taxonomy")).toBeUndefined();
  });

  test("formatErrorColored returns plain when color disabled", () => {
    withEnv({ KIMI_NO_COLOR: "1" }, () => {
      expect(formatErrorColored({ domain: "doctor", message: "probe failed" })).toBe(
        formatErrorPlain({ domain: "doctor", message: "probe failed" })
      );
    });
  });

  test("Logger.errorFormatted emits domain line", async () => {
    await withClearedEnv(["NO_COLOR", "KIMI_NO_COLOR", "KIMI_AGENT_SESSION"], async () => {
      const lines = await captureConsoleError(() => {
        const logger = new Logger({ level: "info", humanStderr: true });
        logger.errorFormatted({
          domain: "secrets",
          message: "Bun.secrets unavailable",
          code: "secrets_missing",
        });
      });
      expect(lines.some((line) => line.includes("com.kimi.toolchain.secrets"))).toBe(true);
    });
  });

  test("buildHttpErrorBody includes reverse-domain envelope", () => {
    const body = buildHttpErrorBody({
      domain: "identity-jwt",
      code: "jwt_expired",
      message: "token expired",
    });
    expect(body.ok).toBe(false);
    expect(body.domain).toBe("com.kimi.toolchain.identity.jwt");
    expect(body.code).toBe("jwt_expired");
    expect(body.error).toBe("token expired");
  });

  test("structuredErrorFields omits ok flag for mixed payloads", () => {
    const fields = structuredErrorFields({
      domain: "identity-jwt",
      code: "jwt_revoked",
      message: "Token revoked",
      severity: "warn",
    });
    expect(fields).toEqual({
      domain: "com.kimi.toolchain.identity.jwt",
      severity: "warn",
      code: "jwt_revoked",
    });
    expect("ok" in fields).toBe(false);
  });

  test("jsonErrorResponse returns application/json", async () => {
    const res = jsonErrorResponse({
      domain: "cli",
      message: "bad flag",
      code: "invalid_flag",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.domain).toBe("com.kimi.toolchain.cli");
  });

  test("lintErrorRegistry passes for canonical registry", () => {
    expect(lintErrorRegistry(REPO_ROOT).filter((i) => i.severity === "error")).toEqual([]);
  });
});
