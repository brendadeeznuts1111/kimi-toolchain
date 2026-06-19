// ── Shell ─────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiShell(): Promise<Response> {
  const { $ } = await import("bun");

  // Read package.json fields
  const name = (await $`bun pm pkg get name`.quiet().text()).trim();
  const version = (await $`bun pm pkg get version`.quiet().text()).trim();

  // ShellError handling demo
  let shellError: Record<string, unknown> = { triggered: false };
  try {
    await $`nonexistent-cmd-xyz`.quiet();
  } catch (e: any) {
    if (e.exitCode !== undefined) {
      shellError = {
        triggered: true,
        constructor: e.constructor.name,
        exitCode: e.exitCode,
        stderr: e.stderr?.toString().slice(0, 60) ?? "",
      };
    }
  }

  // ShellPromise chaining
  const stdout = (await $`echo "hello from Bun Shell"`.nothrow().text()).trim();

  return jsonResponse({
    pkgFields: { name, version },
    shellError,
    stdout,
    methods: [
      "text()",
      "json()",
      "lines()",
      "arrayBuffer()",
      "bytes()",
      "blob()",
      "quiet()",
      "nothrow()",
      "throws(bool)",
      "cwd(dir)",
      "env(obj)",
      "run()",
    ],
    note: "Bun Shell: $`cmd` template literals. ShellError.exitCode for branching. .quiet() suppresses echo. .nothrow() prevents throw on non-zero.",
  });
}
