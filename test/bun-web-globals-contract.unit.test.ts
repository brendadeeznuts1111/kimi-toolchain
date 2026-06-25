import { join } from "path";
import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  runWebGlobalsContractProbes,
  verifyFileConstructor,
  verifyRequestFormDataInvalidThis,
} from "../src/lib/bun-web-globals-contract.ts";

describe("bun-web-globals-contract probes", () => {
  test("runWebGlobalsContractProbes all pass on current Bun", () => {
    const results = runWebGlobalsContractProbes();
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });
});

describe("ERR_INVALID_THIS", () => {
  test("Request.prototype.formData", () => {
    const result = verifyRequestFormDataInvalidThis();
    expect(result.ok).toBe(true);
  });
});

describe("extendable", () => {
  test("Web classes accept subclasses", () => {
    const classes = [Blob, TextDecoder, TextEncoder, Request, Response, Headers, Buffer];
    for (const Class of classes) {
      const Foo = class extends (Class as new () => object) {};
      const bar =
        Class === Request
          ? new Request("https://example.com")
          : Class === Response
            ? new Response()
            : new Foo();
      expect(bar instanceof Class).toBe(true);
      expect(!!Class.prototype).toBe(true);
      expect(typeof Class.prototype).toBe("object");
    }
  });
});

describe("writable", () => {
  const entries: Array<[string, unknown]> = [
    ["TextDecoder", TextDecoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["Buffer", Buffer],
    ["Event", Event],
    ["DOMException", DOMException],
    ["EventTarget", EventTarget],
    ["ErrorEvent", ErrorEvent],
    ["CustomEvent", CustomEvent],
    ["CloseEvent", CloseEvent],
    ["File", File],
  ];

  for (const [name, Class] of entries) {
    test(`${name} global is writable`, () => {
      const previous = (globalThis as Record<string, unknown>)[name];
      try {
        (globalThis as Record<string, unknown>)[name] = 123;
        expect((globalThis as Record<string, unknown>)[name]).toBe(123);
        (globalThis as Record<string, unknown>)[name] = Class;
        expect((globalThis as Record<string, unknown>)[name]).toBe(Class);
      } finally {
        (globalThis as Record<string, unknown>)[name] = previous;
      }
    });
  }
});

describe("name", () => {
  test("Web class names match IDL", () => {
    const classes: Array<[string, { name: string }]> = [
      ["Blob", Blob],
      ["TextDecoder", TextDecoder],
      ["TextEncoder", TextEncoder],
      ["Request", Request],
      ["Response", Response],
      ["Headers", Headers],
      ["Buffer", Buffer],
      ["File", File],
    ];
    for (const [name, Class] of classes) {
      expect(Class.name).toBe(name);
    }
  });
});

describe("File", () => {
  test("constructor", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("bar.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(file.size).toBe(3);
    expect(file.lastModified).toBeGreaterThan(0);
  });

  test("constructor with empty array", () => {
    const file = new File([], "empty.txt", { type: "text/plain;charset=utf-8" });
    expect(file.name).toBe("empty.txt");
    expect(file.size).toBe(0);
  });

  test("constructor with lastModified", () => {
    const file = new File(["foo"], "bar.txt", {
      type: "text/plain;charset=utf-8",
      lastModified: 123,
    });
    expect(file.lastModified).toBe(123);
  });

  test("constructor with undefined name", () => {
    const file = new File(["foo"], undefined as unknown as string);
    expect(file.name).toBe("undefined");
    expect(file.type).toBe("");
    expect(file.size).toBe(3);
  });

  test("constructor throws invalid args", () => {
    const invalid: unknown[][] = [[], [undefined], [null], [Symbol(), "foo"]];
    for (const args of invalid) {
      expect(() => new File(...(args as ConstructorParameters<typeof File>))).toThrow();
    }
  });

  test("constructor without new", () => {
    expect(() => (File as unknown as () => void)()).toThrow({
      name: "TypeError",
      message: "Class constructor File cannot be invoked without 'new'",
    });
  });

  test("instanceof", () => {
    const file = new File(["foo"], "bar.txt", { type: "text/plain" });
    expect(file instanceof File).toBe(true);
    expect(file instanceof Blob).toBe(true);
    expect(new Blob(["foo"]) instanceof File).toBe(false);
  });

  test("extendable", async () => {
    class Foo extends File {
      bar() {
        return true;
      }
      override text() {
        return super.text();
      }
    }
    const foo = new Foo(["foo"], "bar.txt", { type: "text/plain" });
    expect(foo instanceof File).toBe(true);
    expect(foo.bar()).toBe(true);
    expect(await foo.text()).toBe("foo");
  });

  test("verifyFileConstructor probe", () => {
    expect(verifyFileConstructor().ok).toBe(true);
  });
});

test("globals are deletable", () => {
  const fixture = join(REPO_ROOT, "test/fixtures/deletable-globals.ts");
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [process.execPath, "run", fixture],
    stderr: "inherit",
  });
  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});

test("self is a getter", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
  expect(descriptor?.get).toBeInstanceOf(Function);
  expect(descriptor?.set).toBeInstanceOf(Function);
  expect(descriptor?.enumerable).toBe(true);
  expect(descriptor?.configurable).toBe(true);
  expect((globalThis as unknown as { self: unknown }).self).toBe(globalThis);
});

test("errors thrown by native code should be TypeError", async () => {
  expect(() => (Bun.dns.prefetch as (hostname?: string) => void)()).toThrow(TypeError);
  // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- contract: GET + body must throw TypeError
  await expect(fetch("http://localhost", { method: "GET", body: "123" })).rejects.toThrow(
    TypeError
  );
});

describe("globalThis.gc", () => {
  const runAndPrint = (expr: string, ...args: string[]): string => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, ...args, "--print", expr],
      env: { ...process.env, NODE_ENV: "test" },
    });
    if (!result.success) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };

  test("undefined without --expose-gc", () => {
    expect(runAndPrint("typeof globalThis.gc")).toBe("undefined");
    expect(runAndPrint("'gc' in globalThis")).toBe("false");
  });

  test("function with --expose-gc", () => {
    expect(runAndPrint("typeof globalThis.gc", "--expose-gc")).toBe("function");
    expect(runAndPrint("gc === globalThis.gc", "--expose-gc")).toBe("true");
  });

  test("cleans up memory with --expose-gc", () => {
    const src = `
      let arr = [];
      for (let i = 0; i < 100; i++) arr.push(new Array(100_000));
      arr.length = 0;
      const before = process.memoryUsage().heapUsed;
      globalThis.gc();
      return before - process.memoryUsage().heapUsed;
    `;
    const delta = Number.parseInt(runAndPrint(`(function() { ${src} })()`, "--expose-gc"), 10);
    expect(Number.isNaN(delta)).toBe(false);
    expect(delta).toBeGreaterThanOrEqual(0);
  });
});
