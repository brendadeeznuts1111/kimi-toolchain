// ── Bun Build ──────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiBuildCompile(): Promise<Response> {
  return jsonResponse({
    cliFlags: [
      { flag: "--compile", description: "Generate standalone executable" },
      {
        flag: "--target",
        description: "bun|bun-darwin-arm64|bun-linux-x64|bun-windows-x64|bun-linux-x64-musl|node",
      },
      { flag: "--outfile", description: "Output path (.exe on Windows)" },
      { flag: "--minify", description: "Minify output" },
      { flag: "--sourcemap", description: "Generate sourcemap (inline|external|none)" },
      {
        flag: "--compile-exec-argv",
        description: "Embed runtime args into executable (process.execArgv)",
      },
      { flag: "--user-agent", description: "Override User-Agent header for fetch()" },
      { flag: "--windows-title", description: "Windows EXE: application title" },
      { flag: "--windows-publisher", description: "Windows EXE: publisher name" },
      { flag: "--windows-version", description: "Windows EXE: version (e.g. 1.2.3.4)" },
      { flag: "--windows-description", description: "Windows EXE: file description" },
      { flag: "--windows-copyright", description: "Windows EXE: copyright string" },
      { flag: "--windows-icon", description: "Windows EXE: .ico file path" },
    ],
    apiExamples: [
      {
        label: "Shorthand target",
        code: `await Bun.build({
  entrypoints: ["./cli.ts"],
  compile: "bun-linux-x64-musl",  // cross-compile shorthand
});`,
      },
      {
        label: "Full config + Windows icon",
        code: `await Bun.build({
  entrypoints: ["./cli.ts"],
  compile: {
    target: "bun-windows-x64",
    outfile: "./my-app-windows",
    windows: { icon: "./icon.ico" },
  },
});`,
      },
      {
        label: "Embed runtime flags",
        code: `bun build ./index.ts --compile --outfile=my-app \\
  --compile-exec-argv="--smol --user-agent=MyApp/1.0"
// process.execArgv = ["--smol", "--user-agent=MyApp/1.0"]`,
      },
    ],
    bunxPackage: "bunx --package renovate renovate-config-validator  # binary ≠ package name",
    sideEffectsGlob:
      'package.json: { "sideEffects": ["**/*.css", "./src/components/*.js"] } — supports *, ?, **, [], {}',
    note: "Bun.build() now supports compile as string (shorthand) or object. bundler plugins supported. --compile-exec-argv embeds runtime args. bunx --package handles name≠binary.",
  });
}
