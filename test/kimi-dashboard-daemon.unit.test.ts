import { describe, expect, test } from "bun:test";
import { join } from "path";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { REPO_ROOT, withIsolatedHome } from "./helpers.ts";

const DASHBOARD = join(REPO_ROOT, "src/bin/kimi-dashboard.ts");

describe.serial("kimi-dashboard daemon", () => {
  test.skipIf(Bun.env.KIMI_TEST_CHANGED_PARALLEL === "1")(
    "--daemon spawns detached server and writes pid file",
    async () => {
      await withIsolatedHome(async (home) => {
        const pidPath = join(home, ".kimi-code", "var", "examples-dashboard.pid");

        let healthy = false;
        let pid = 0;

        for (let portAttempt = 0; portAttempt < 8 && !healthy; portAttempt++) {
          const port = 28000 + portAttempt * 31 + Math.floor(Math.random() * 50);

          const launcher = Bun.spawn(["bun", DASHBOARD, "--daemon", `--port=${port}`], {
            cwd: REPO_ROOT,
            env: { ...Bun.env, HOME: home },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            readableStreamToText(launcher.stdout),
            readableStreamToText(launcher.stderr),
            launcher.exited,
          ]);
          if (exitCode !== 0) {
            await Bun.sleep(200);
            continue;
          }
          expect(stdout + stderr).toContain(`port=${port}`);

          pid = Number((await Bun.file(pidPath).text()).trim());
          expect(Number.isFinite(pid)).toBe(true);

          for (let attempt = 0; attempt < 25; attempt++) {
            await Bun.sleep(80);
            try {
              const res = await fetch(`http://127.0.0.1:${port}/health`);
              if (res.ok) {
                healthy = true;
                break;
              }
            } catch {
              // server still booting
            }
          }

          if (!healthy) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              // already exited
            }
            await Bun.sleep(200);
          }
        }

        expect(healthy).toBe(true);

        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already exited
        }
        await Bun.sleep(300);
      });
    },
    60_000
  );
});
