// ── ShadowRealm ────────────────────────────────────────────────────

export async function apiShadowRealm(): Promise<Response> {
  const realmIso = createIsolation("realm");

  await Bun.write(
    "/tmp/_realm_module.js",
    `
export function add(a, b) { return a + b; }
export function multiply(a, b) { return a * b; }
export const version = "realm-v1";
`
  );

  const realm = new ShadowRealm();

  realm.evaluate("globalThis.secret = 'inside-realm'");
  const innerSecret = realm.evaluate("globalThis.secret");
  const outerSecret = (globalThis as { secret?: string }).secret;

  const factoryEval = await realmIso.evaluateScript("2 * 3");

  const add = await realm.importValue("/tmp/_realm_module.js", "add");
  const multiply = await realm.importValue("/tmp/_realm_module.js", "multiply");
  const version = await realm.importValue("/tmp/_realm_module.js", "version");

  await Bun.write(
    "/tmp/_realm_bridge.js",
    `
export function applyCallback(cb, x) { return cb(x) * 2; }
`
  );
  const applyCallback = await realm.importValue("/tmp/_realm_bridge.js", "applyCallback");
  const bridged = applyCallback((x: number) => x ** 3, 2);

  return jsonResponse({
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
    note: "ShadowRealm — TC39 proposal. Factory evaluateScript() for code strings; importValue() for module bridging (direct ShadowRealm only).",
  });
}
