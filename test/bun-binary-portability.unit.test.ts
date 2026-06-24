import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import {
  ALLOWED_DLL_IMPORTS,
  formatPortabilityViolationTable,
  glibcVersionAboveFloor,
  parseGlibcSymbolViolations,
  parseLibatomicLines,
  parsePeImports,
  peImportViolations,
} from "../src/lib/bun-binary-portability.ts";

const BUN_EXE = process.execPath;

describe("bun-binary-portability glibc-version-above-floor", () => {
  test("compares integer tuples not semver", () => {
    expect(glibcVersionAboveFloor("2.2.5")).toBe(false);
    expect(glibcVersionAboveFloor("2.3.4")).toBe(false);
    expect(glibcVersionAboveFloor("2.17")).toBe(false);
    expect(glibcVersionAboveFloor("2.17.1")).toBe(true);
    expect(glibcVersionAboveFloor("2.18")).toBe(true);
    expect(glibcVersionAboveFloor("2.25")).toBe(true);
    expect(glibcVersionAboveFloor("3.0")).toBe(true);
  });
});

describe("parseGlibcSymbolViolations", () => {
  test("flags only symbols above glibc 2.17", () => {
    const sample = `
0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.2.5) memcpy
0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.17) clock_gettime
0000000000000000      DF *UND*  0000000000000000 (GLIBC_2.18) __cxa_thread_atexit_impl
`.trim();
    const violations = parseGlibcSymbolViolations(sample);
    expect(violations).toEqual([{ symbol: "__cxa_thread_atexit_impl", glibcVersion: "2.18" }]);
  });
});

describe("parseLibatomicLines", () => {
  test("detects libatomic linkage lines", () => {
    const sample = `
\tlinux-vdso.so.1 (0x00007fff)
\tlibpthread.so.0 => /lib/libpthread.so.0
\tlibatomic.so.1 => /lib64/libatomic.so.1
`.trim();
    expect(parseLibatomicLines(sample)).toEqual(["\tlibatomic.so.1 => /lib64/libatomic.so.1"]);
  });
});

describe("parsePeImports", () => {
  test("parses static and delay imports from llvm-readobj output", () => {
    const sample = `
Import {
  Name: KERNEL32.dll
}
DelayImport {
  Name: ole32.dll
}
Import {
  Name: VCRUNTIME140_1.dll
}
`.trim();
    expect(parsePeImports(sample)).toEqual([
      { dll: "KERNEL32.dll", kind: "static" },
      { dll: "ole32.dll", kind: "delay" },
      { dll: "VCRUNTIME140_1.dll", kind: "static" },
    ]);
  });
});

describe("peImportViolations", () => {
  test("allows kernel32 and delay-loaded vcruntime140_1", () => {
    const imports = parsePeImports(`
Import { Name: KERNEL32.dll }
DelayImport { Name: vcruntime140_1.dll }
Import { Name: ADVAPI32.dll }
`);
    expect(peImportViolations(imports)).toEqual([]);
    expect(ALLOWED_DLL_IMPORTS.has("kernel32.dll")).toBe(true);
  });

  test("flags hard vcruntime140_1 and api-ms-win-crt imports", () => {
    const imports = parsePeImports(`
Import { Name: VCRUNTIME140_1.dll }
Import { Name: api-ms-win-crt-stdio-l1-1-0.dll }
`);
    expect(peImportViolations(imports)).toEqual([
      { dll: "VCRUNTIME140_1.dll", kind: "static" },
      { dll: "api-ms-win-crt-stdio-l1-1-0.dll", kind: "static" },
    ]);
  });
});

describe("formatPortabilityViolationTable", () => {
  test("renders violation rows with depth 0", () => {
    const table = formatPortabilityViolationTable([{ symbol: "foo", "glibc version": "2.18" }], {
      colors: false,
    });
    expect(table).toContain("foo");
    expect(table).toContain("2.18");
  });
});

if (process.platform === "linux") {
  describe("bun executable linux portability", () => {
    test("objdump -T does not include symbols from glibc > 2.17", async () => {
      const objdump = Bun.which("objdump") || Bun.which("llvm-objdump");
      if (!objdump) {
        throw new Error("objdump executable not found. Please install it.");
      }

      const output = await $`${objdump} -T ${BUN_EXE} | grep GLIBC_`.nothrow().text();
      const errors = parseGlibcSymbolViolations(output);
      if (errors.length) {
        throw new Error(
          `Found glibc symbols > 2.17. This breaks RHEL/CentOS 7 and Amazon Linux 1.\n\n${formatPortabilityViolationTable(errors)}`
        );
      }
    });

    test("libatomic.so is not linked", async () => {
      const ldd = Bun.which("ldd");
      if (!ldd) {
        throw new Error("ldd executable not found. Please install it.");
      }

      const output = await $`${ldd} ${BUN_EXE}`.text();
      const errors = parseLibatomicLines(output);
      if (errors.length) {
        throw new Error(
          `libatomic.so is linked. This breaks Amazon Linux 2 and Vercel.\n\n${errors.join("\n")}`
        );
      }
    });
  });
}

if (process.platform === "win32") {
  describe("bun executable windows portability", () => {
    test("PE import table contains only allowlisted system DLLs", async () => {
      const readobj = Bun.which("llvm-readobj");
      if (!readobj) {
        throw new Error("llvm-readobj not found. It ships with LLVM (required to build bun).");
      }

      const output = await $`${readobj} --coff-imports ${BUN_EXE}`.text();
      const imports = parsePeImports(output);
      if (imports.length === 0) {
        throw new Error(
          `Failed to parse imports from llvm-readobj — parser broken?\n\n${output.slice(0, 500)}`
        );
      }

      const violations = peImportViolations(imports);
      if (violations.length > 0) {
        throw new Error(
          `bun.exe imports non-allowlisted DLLs. This causes STATUS_DLL_NOT_FOUND on machines without VC++ redist.\n\n` +
            `${formatPortabilityViolationTable(violations)}\n` +
            `Full import list (${imports.length}):\n` +
            imports.map((i) => `  [${i.kind.padEnd(6)}] ${i.dll}`).join("\n")
        );
      }

      expect(imports.some((i) => i.dll.toLowerCase() === "kernel32.dll")).toBe(true);
    });
  });
}
