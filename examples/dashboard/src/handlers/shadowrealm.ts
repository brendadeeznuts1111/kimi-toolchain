// ── ShadowRealm ────────────────────────────────────────────────────
import { join } from "path";
import { pathToFileURL } from "node:url";
import { $ } from "bun";
import { createIsolation } from "../lib/isolation/index.ts";
import { jsonErrorResponse, jsonResponse, resolveRoot } from "./shared.ts";

/** Repo-local module fixtures — never use /tmp (macOS /private/tmp resolve drift). */
export const SHADOW_REALM_TMP = join(resolveRoot(), ".tmp", "shadow-realm");

export const SHADOW_REALM_MODULE_FILES = {
  realm: join(SHADOW_REALM_TMP, "realm_module.js"),
  bridge: join(SHADOW_REALM_TMP, "realm_bridge.js"),
} as const;

interface ShadowRealmModuleUrls {
  realm: string;
  bridge: string;
}

let prepareModules: Promise<ShadowRealmModuleUrls> | null = null;
let demoInFlight: Promise<Response> | null = null;

async function ensureShadowRealmModules(): Promise<ShadowRealmModuleUrls> {
  if (!prepareModules) {
    prepareModules = (async () => {
      await $`mkdir -p ${SHADOW_REALM_TMP}`.quiet().nothrow();

      await Bun.write(
        SHADOW_REALM_MODULE_FILES.realm,
        `export function add(a, b) { return a + b; }
export function multiply(a, b) { return a * b; }
export const version = "realm-v1";
`
      );

      await Bun.write(
        SHADOW_REALM_MODULE_FILES.bridge,
        `export function applyCallback(cb, x) { return cb(x) * 2; }
`
      );

      for (const path of Object.values(SHADOW_REALM_MODULE_FILES)) {
        if (!(await Bun.file(path).exists())) {
          throw new Error(`ShadowRealm fixture missing after write: ${path}`);
        }
      }

      return {
        realm: pathToFileURL(SHADOW_REALM_MODULE_FILES.realm).href,
        bridge: pathToFileURL(SHADOW_REALM_MODULE_FILES.bridge).href,
      };
    })();
  }
  return prepareModules;
}

async function runShadowRealmDemo(): Promise<Response> {
  const urls = await ensureShadowRealmModules();
  const realmIso = createIsolation("realm");
  const realm = new ShadowRealm();

  realm.evaluate("globalThis.secret = 'inside-realm'");
  const innerSecret = realm.evaluate("globalThis.secret");
  const outerSecret = (globalThis as { secret?: string }).secret;

  const factoryEval = await realmIso.evaluateScript("2 * 3");

  const add = await realm.importValue(urls.realm, "add");
  const multiply = await realm.importValue(urls.realm, "multiply");
  const version = await realm.importValue(urls.realm, "version");
  const applyCallback = await realm.importValue(urls.bridge, "applyCallback");
  const bridged = applyCallback((x: number) => x ** 3, 2);

  return jsonResponse({
    ok: true,
    fixtures: SHADOW_REALM_MODULE_FILES,
    factory: {
      mode: realmIso.mode,
      evaluateScript: factoryEval,
    },
    isolate: {
      innerSecret,
      outerSecret: outerSecret ?? "undefined",
      verified: innerSecret === "inside-realm" && outerSecret === undefined,
    },
    imports: {
      "add(2,3)": add(2, 3),
      "multiply(4,5)": multiply(4, 5),
      version,
    },
    bridging: {
      expression: "applyCallback(x => x**3, 2)",
      expected: 16,
      result: bridged,
    },
    note: "ShadowRealm importValue uses file:// URLs under .tmp/shadow-realm (repo-local, not /tmp).",
  });
}

export async function apiShadowRealm(): Promise<Response> {
  if (demoInFlight) return demoInFlight;

  demoInFlight = (async () => {
    try {
      return await runShadowRealmDemo();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonErrorResponse(
        {
          domain: "http",
          code: "shadow_realm_failed",
          message,
          severity: "error",
        },
        500,
        {
          route: "/api/shadow-realm",
          fixtures: SHADOW_REALM_MODULE_FILES,
          hint: "Restart dashboard after pull — old builds used /tmp/_realm_module.js",
        }
      );
    } finally {
      demoInFlight = null;
    }
  })();

  return demoInFlight;
}
