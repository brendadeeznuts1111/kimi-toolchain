import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT, withIsolatedHome } from "./helpers.ts";

const DASHBOARD = join(REPO_ROOT, "src/bin/kimi-dashboard.ts");

describe("kimi-dashboard daemon", () => {
  test("--daemon spawns detached server and writes pid file", async () => {
    await withIsolatedHome(async (home) => {
      const port = 15000 + Math.floor(Math.random() * 1000);
      const pidPath = join(home, ".kimi-code", "var", "examples-dashboard.pid");

      const launcher = Bun.spawn(["bun", DASHBOARD, "--daemon", `--port=${port}`], {
        cwd: REPO_ROOT,
        env: { ...Bun.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(launcher.stdout).text(),
        new Response(launcher.stderr).text(),
        launcher.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout + stderr).toContain(`port=${port}`);

      const pid = Number((await Bun.file(pidPath).text()).trim());
      expect(Number.isFinite(pid)).toBe(true);

      let healthy = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await Bun.sleep(300);
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
      expect(healthy).toBe(true);

      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already exited
      }
      await Bun.sleep(300);
    });
  }, 15_000);
});
