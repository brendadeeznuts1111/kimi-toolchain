import { describe, expect, test } from "bun:test";
import {
  buildHerdrSocketRecoveryPlan,
  materializeHerdrSocketRecoveryPlan,
  parseHerdrCliProtocolError,
  parsePgrepHerdrServerLines,
} from "../src/lib/herdr-cli-error.ts";
import { parseHerdrCliSocketError } from "../src/lib/herdr-doctor.ts";
import { parseSocketConnectErrorCode } from "../src/lib/herdr-socket-transport.ts";

describe("herdr-cli-error", () => {
  test("parseHerdrCliProtocolError maps os error 35 to saturation taxonomy", () => {
    const parsed = parseHerdrCliProtocolError(
      "herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)"
    );
    expect(parsed?.code).toBe("EAGAIN");
    expect(parsed?.taxonomyId).toBe("herdr_socket_saturation");
    expect(parsed?.osError).toBe(35);
  });

  test("parseHerdrCliProtocolError maps os error 61 to attach refused taxonomy", () => {
    const parsed = parseHerdrCliProtocolError(
      "herdr: protocol error: I/O error: Connection refused (os error 61)"
    );
    expect(parsed?.code).toBe("ECONNREFUSED");
    expect(parsed?.taxonomyId).toBe("herdr_cli_attach_refused");
    expect(parsed?.osError).toBe(61);
  });

  test("parseHerdrCliProtocolError ignores non-herdr output", () => {
    expect(parseHerdrCliProtocolError("Resource temporarily unavailable (os error 35)")).toBeNull();
    expect(parseHerdrCliSocketError("herdr status ok")).toBeNull();
  });

  test("buildHerdrSocketRecoveryPlan never auto-kills and validates status first", () => {
    const plan = buildHerdrSocketRecoveryPlan({
      code: "EAGAIN",
      serverRunning: true,
      socketPath: "/tmp/herdr.sock",
    });
    expect(plan[0]?.destructive).toBe(false);
    expect(plan[0]?.command).toContain("herdr status");
    const destructive = plan.filter((s) => s.destructive);
    expect(destructive.every((s) => s.command?.includes("server"))).toBe(true);
    expect(destructive.some((s) => s.command?.includes("pkill"))).toBe(false);
  });

  test("parseSocketConnectErrorCode detects EAGAIN and ECONNREFUSED messages", () => {
    expect(parseSocketConnectErrorCode(new Error("connect EAGAIN"))).toBe("EAGAIN");
    expect(
      parseSocketConnectErrorCode(new Error("Resource temporarily unavailable (os error 35)"))
    ).toBe("EAGAIN");
    expect(parseSocketConnectErrorCode(new Error("connect ECONNREFUSED os error 61"))).toBe(
      "ECONNREFUSED"
    );
  });

  test("parsePgrepHerdrServerLines handles macOS -fl and Linux -a output", () => {
    const mac = parsePgrepHerdrServerLines(
      "67151 /opt/homebrew/opt/herdr/bin/herdr server\n14590 herdr\n"
    );
    expect(mac).toEqual([{ pid: 67151, command: "/opt/homebrew/opt/herdr/bin/herdr server" }]);

    const linux = parsePgrepHerdrServerLines(
      "24955 /usr/bin/herdr --session dev server\n24956 herdr-pane status\n"
    );
    expect(linux).toEqual([{ pid: 24955, command: "/usr/bin/herdr --session dev server" }]);
  });

  test("parsePgrepHerdrServerLines accepts symlink argv0 and bunx launcher", () => {
    const symlink = parsePgrepHerdrServerLines(
      "88001 /usr/local/bin/herdr server\n88002 /opt/herdr/herdr server\n"
    );
    expect(symlink.map((p) => p.pid)).toEqual([88001, 88002]);

    const bunx = parsePgrepHerdrServerLines(
      "99001 bunx herdr server\n99002 node /Users/me/.bun/bin/bunx herdr server\n"
    );
    expect(bunx.map((p) => p.pid)).toEqual([99001, 99002]);
  });

  test("parsePgrepHerdrServerLines excludes server stop one-shots and non-herdr wrappers", () => {
    const mixed = parsePgrepHerdrServerLines(
      [
        "70001 /opt/homebrew/bin/herdr server stop",
        "70002 /opt/homebrew/bin/herdr server",
        "70003 bash ./scripts/run-herdr-daemon.sh server",
      ].join("\n")
    );
    expect(mixed).toEqual([{ pid: 70002, command: "/opt/homebrew/bin/herdr server" }]);
  });

  test("materializeHerdrSocketRecoveryPlan substitutes server PID for dry-run kill", () => {
    const plan = buildHerdrSocketRecoveryPlan({
      code: "EAGAIN",
      serverRunning: true,
      socketPath: "/tmp/herdr.sock",
    });
    const killStep = plan.find((s) => s.command?.includes("<server-pid>"));
    expect(killStep).toBeDefined();
    const materialized = materializeHerdrSocketRecoveryPlan(plan, {
      serverPids: [{ pid: 67151, command: "/opt/homebrew/opt/herdr/bin/herdr server" }],
      dryRun: true,
    });
    const kill = materialized.find((s) => s.destructive);
    expect(kill?.command).toContain("kill -TERM 67151");
    expect(kill?.wouldRun).toContain("[dry-run] would run");
  });
});
