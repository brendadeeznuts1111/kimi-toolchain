/**
 * Web API global contracts — ERR_INVALID_THIS, extendability, File semantics.
 * Ported from oven-sh/bun global object tests; used by verify:bun-features.
 */

export interface WebGlobalsProbeResult {
  id: string;
  ok: boolean;
  detail: string;
}

type InvalidThisCase = {
  receiver: unknown;
  message: string;
};

const REQUEST_FORMDATA_INVALID_THIS: InvalidThisCase[] = [
  { receiver: undefined, message: "Expected this to be instanceof Request" },
  { receiver: null, message: "Expected this to be instanceof Request, but received null" },
  {
    receiver: new (class Boop {})(),
    message: "Expected this to be instanceof Request, but received an instance of Boop",
  },
  {
    receiver: "hellooo",
    message: "Expected this to be instanceof Request, but received type string ('hellooo')",
  },
];

/** Verify Request.prototype.formData ERR_INVALID_THIS messages. */
export function verifyRequestFormDataInvalidThis(): WebGlobalsProbeResult {
  const failures: string[] = [];
  for (const { receiver, message } of REQUEST_FORMDATA_INVALID_THIS) {
    try {
      (Request.prototype as Request & { formData(this: unknown): Promise<FormData> }).formData.call(
        receiver
      );
      failures.push(`expected throw for receiver ${String(receiver)}`);
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code !== "ERR_INVALID_THIS")
        failures.push(`code ${err.code ?? "?"} !== ERR_INVALID_THIS`);
      if (err.name !== "TypeError") failures.push(`name ${err.name} !== TypeError`);
      if (err.message !== message) failures.push(`message mismatch: ${err.message}`);
    }
  }
  return {
    id: "web.request.invalidThis",
    ok: failures.length === 0,
    detail: failures.length === 0 ? "ERR_INVALID_THIS × 4" : failures.join("; "),
  };
}

const EXTENDABLE_WEB_CLASSES: Array<new (...args: never[]) => object> = [
  Blob,
  TextDecoder,
  TextEncoder,
  Request,
  Response,
  Headers,
  Buffer,
];

/** Native Web classes accept user subclasses. */
export function verifyExtendableWebClasses(): WebGlobalsProbeResult {
  const failures: string[] = [];
  for (const Class of EXTENDABLE_WEB_CLASSES) {
    try {
      const Sub = class extends (Class as new () => object) {};
      const instance =
        Class === Request
          ? new Request("https://example.com")
          : Class === Response
            ? new Response()
            : new Sub();
      if (!(instance instanceof Class)) failures.push(`${Class.name} subclass instanceof failed`);
      if (!Class.prototype || typeof Class.prototype !== "object") {
        failures.push(`${Class.name} prototype missing`);
      }
    } catch (error) {
      failures.push(`${Class.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof HTMLRewriter !== "undefined") {
    try {
      const Sub = class extends HTMLRewriter {};
      const instance = new Sub();
      if (!(instance instanceof HTMLRewriter))
        failures.push("HTMLRewriter subclass instanceof failed");
    } catch (error) {
      failures.push(`HTMLRewriter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    id: "web.extendable",
    ok: failures.length === 0,
    detail:
      failures.length === 0
        ? `${EXTENDABLE_WEB_CLASSES.length}+ classes extendable`
        : failures.join("; "),
  };
}

const NAMED_WEB_CLASSES: Array<[string, { name: string }]> = [
  ["Blob", Blob],
  ["TextDecoder", TextDecoder],
  ["TextEncoder", TextEncoder],
  ["Request", Request],
  ["Response", Response],
  ["Headers", Headers],
  ["Buffer", Buffer],
  ["File", File],
];

/** Class `.name` matches Web IDL identifiers. */
export function verifyWebClassNames(): WebGlobalsProbeResult {
  const failures: string[] = [];
  for (const [expected, Class] of NAMED_WEB_CLASSES) {
    if (Class.name !== expected) failures.push(`${Class.name} !== ${expected}`);
  }
  if (typeof HTMLRewriter !== "undefined" && HTMLRewriter.name !== "HTMLRewriter") {
    failures.push(`HTMLRewriter.name === ${HTMLRewriter.name}`);
  }
  return {
    id: "web.classNames",
    ok: failures.length === 0,
    detail: failures.length === 0 ? `${NAMED_WEB_CLASSES.length} names match` : failures.join("; "),
  };
}

/** File constructor basics used by archive/sync paths. */
export function verifyFileConstructor(): WebGlobalsProbeResult {
  const failures: string[] = [];
  try {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    if (file.name !== "bar.txt") failures.push(`name ${file.name}`);
    if (file.size !== 3) failures.push(`size ${file.size}`);
    if (!(file instanceof Blob)) failures.push("not instanceof Blob");
    const empty = new File([], "empty.txt");
    if (empty.size !== 0) failures.push(`empty size ${empty.size}`);
    const withMod = new File(["foo"], "bar.txt", { lastModified: 123 });
    if (withMod.lastModified !== 123) failures.push(`lastModified ${withMod.lastModified}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return {
    id: "web.file",
    ok: failures.length === 0,
    detail: failures.length === 0 ? "File(name, size, Blob, lastModified)" : failures.join("; "),
  };
}

/** globalThis.self getter returns globalThis. */
export function verifySelfGetter(): WebGlobalsProbeResult {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
  if (!descriptor?.get || !descriptor.set) {
    return { id: "web.self", ok: false, detail: "self missing getter/setter" };
  }
  if (!descriptor.configurable || !descriptor.enumerable) {
    return { id: "web.self", ok: false, detail: "self not configurable/enumerable" };
  }
  if ((globalThis as typeof globalThis & { self: typeof globalThis }).self !== globalThis) {
    return { id: "web.self", ok: false, detail: "self !== globalThis" };
  }
  return { id: "web.self", ok: true, detail: "getter/setter configurable" };
}

/** Run in-process Web global contract probes (no subprocess). */
export function runWebGlobalsContractProbes(): WebGlobalsProbeResult[] {
  return [
    verifyRequestFormDataInvalidThis(),
    verifyExtendableWebClasses(),
    verifyWebClassNames(),
    verifyFileConstructor(),
    verifySelfGetter(),
  ];
}
