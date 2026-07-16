// ── Child Process ──────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiExec(): Promise<Response> {
  const { exec } = await import("node:child_process");

  return new Promise((resolve) => {
    let results: Record<string, { stdout: string; stderr: string }> = {};
    let pending = 3;

    const done = () => {
      if (--pending === 0) {
        resolve(
          jsonResponse({
            results,
            note: "node:child_process.exec() — runs command string through a shell. Use quotes for paths with spaces. \\$ escapes variables. Bun mirrors Node.js exec exactly.",
          })
        );
      }
    };

    exec("echo hello from exec", (_err, stdout, stderr) => {
      results.basic = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });

    exec('echo "path with spaces intact"', (_err, stdout, stderr) => {
      results.quoted = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });

    exec("echo HOME is $HOME", (_err, stdout, stderr) => {
      results.variableExpansion = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });
  });
}
