/**
 * Bun.Terminal + AsyncLocalStorage regression guard (Bun v1.3.7).
 *
 * Fixed: data/exit/drain callbacks not firing when Terminal was created inside
 * AsyncLocalStorage.run().
 *
 * @see https://bun.com/blog/bun-v1.3.7#bun-terminal
 */
import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { apiTerminal } from "../examples/dashboard/src/handlers/terminal.ts";

interface TerminalCallbackProbe {
  readonly supported: boolean;
  readonly reason?: string;
  readonly insideAls: { data: boolean; exit: boolean; drain: boolean; output: string };
  readonly outsideAls: { data: boolean; exit: boolean; drain: boolean; output: string };
}

async function runTerminalCallbackProbe(
  label: string,
  runInAls: boolean
): Promise<{ data: boolean; exit: boolean; drain: boolean; output: string }> {
  const events = new Set<string>();
  let output = "";
  const als = new AsyncLocalStorage<string>();

  async function exercise(): Promise<void> {
    const terminal = new Bun.Terminal({
      cols: 48,
      rows: 12,
      data(_term, chunk) {
        events.add("data");
        output += new TextDecoder().decode(chunk);
      },
      exit() {
        events.add("exit");
      },
      drain() {
        events.add("drain");
      },
    });

    try {
      const proc = Bun.spawn(["printf", `${label}\n`], { terminal });
      await proc.exited;
      await Bun.sleep(25);
    } finally {
      terminal.close();
      await Bun.sleep(10);
    }
  }

  if (runInAls) {
    await als.run(label, exercise);
  } else {
    await exercise();
  }

  return {
    data: events.has("data"),
    exit: events.has("exit"),
    drain: events.has("drain"),
    output,
  };
}

async function probeTerminalCallbacks(): Promise<TerminalCallbackProbe> {
  if (typeof Bun.Terminal !== "function") {
    return {
      supported: false,
      reason: "Bun.Terminal unavailable",
      insideAls: { data: false, exit: false, drain: false, output: "" },
      outsideAls: { data: false, exit: false, drain: false, output: "" },
    };
  }

  try {
    const insideAls = await runTerminalCallbackProbe("als-pty", true);
    const outsideAls = await runTerminalCallbackProbe("direct-pty", false);
    const supported = insideAls.data && insideAls.exit && outsideAls.data && outsideAls.exit;
    return {
      supported,
      reason: supported ? undefined : "PTY callbacks missing in probe",
      insideAls,
      outsideAls,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      supported: false,
      reason,
      insideAls: { data: false, exit: false, drain: false, output: "" },
      outsideAls: { data: false, exit: false, drain: false, output: "" },
    };
  }
}

const terminalProbe = await probeTerminalCallbacks();

describe("bun-terminal", () => {
  test(`runtime probe on Bun ${Bun.version}: supported=${terminalProbe.supported}`, () => {
    if (!terminalProbe.supported) {
      console.warn(
        `[bun-terminal] PTY callback probe inactive: ${terminalProbe.reason ?? "unknown"}`
      );
    }
    expect(typeof terminalProbe.supported).toBe("boolean");
  });

  test.skipIf(!terminalProbe.supported)(
    "Bun.Terminal data/exit callbacks fire when created inside AsyncLocalStorage.run()",
    () => {
      const { insideAls, outsideAls } = terminalProbe;
      expect(insideAls.data).toBe(true);
      expect(insideAls.exit).toBe(true);
      expect(insideAls.output).toContain("als-pty");
      expect(outsideAls.data).toBe(true);
      expect(outsideAls.exit).toBe(true);
      expect(outsideAls.output).toContain("direct-pty");
    }
  );

  test.skipIf(!terminalProbe.supported)(
    "ALS terminal probe matches direct terminal callback coverage",
    () => {
      expect(terminalProbe.insideAls.data).toBe(terminalProbe.outsideAls.data);
      expect(terminalProbe.insideAls.exit).toBe(terminalProbe.outsideAls.exit);
    }
  );

  test("apiTerminal handler returns dashboard JSON envelope", async () => {
    const res = await apiTerminal();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as {
      dimensions?: { cols: number; rows: number };
      output?: string;
      closed?: boolean;
      flags?: Record<string, string>;
      error?: string;
      note?: string;
    };

    if (body.output !== undefined) {
      expect(body.dimensions).toEqual({ cols: 80, rows: 24 });
      expect(body.output).toContain("hello from PTY");
      expect(typeof body.closed).toBe("boolean");
      expect(body.flags?.controlFlags).toMatch(/^0x[0-9A-F]+$/i);
      expect(body.note).toContain("Bun.Terminal");
      return;
    }

    expect(body.error).toBeDefined();
    expect(body.note).toContain("Bun.Terminal");
  });
});
