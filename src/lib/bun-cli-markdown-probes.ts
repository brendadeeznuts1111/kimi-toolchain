/**
 * Runtime probes ported from oven-sh/bun `test/cli/run/markdown-entrypoint.test.ts` (subset).
 */

import { cliProbe, withCliFixture } from "./bun-cli-fixture.ts";

export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export async function runMarkdownEntrypointContractProbes(): Promise<CliContractProbeResult[]> {
  const headings = await withCliFixture(
    "md-headings",
    { "doc.md": "# Heading 1\n\n## Heading 2\n\nbody\n" },
    ["doc.md"],
    { FORCE_COLOR: "1", TERM: "xterm-256color" }
  );

  const noColor = await withCliFixture(
    "md-no-color",
    { "doc.md": "# Hello\n\n**world**\n" },
    ["doc.md"],
    { NO_COLOR: "1" }
  );

  return [
    cliProbe(
      "cli.run.markdown.headings",
      headings.exitCode === 0 && headings.stdout.length > 0,
      headings.exitCode === 0 ? "rendered" : `exit=${headings.exitCode}`
    ),
    cliProbe(
      "cli.run.markdown.no-color",
      noColor.exitCode === 0 && !noColor.stdout.includes("\x1b["),
      noColor.exitCode === 0 ? "plain" : `exit=${noColor.exitCode}`
    ),
  ];
}
