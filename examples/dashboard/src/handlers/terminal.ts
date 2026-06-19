// ── Terminal ───────────────────────────────────────────────────────

export async function apiTerminal(): Promise<Response> {
  let ptyOutput = "";
  let flags: Record<string, string> = {};

  try {
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, data) {
        ptyOutput += new TextDecoder().decode(data);
      },
    });

    // Capture termios flags before running command
    flags = {
      controlFlags: "0x" + terminal.controlFlags.toString(16).toUpperCase(),
      inputFlags: "0x" + terminal.inputFlags.toString(16).toUpperCase(),
      localFlags: "0x" + terminal.localFlags.toString(16).toUpperCase(),
      outputFlags: "0x" + terminal.outputFlags.toString(16).toUpperCase(),
    };

    // Toggle raw mode briefly to show capability
    terminal.setRawMode(true);
    const rawFlags = {
      rawControl: "0x" + terminal.controlFlags.toString(16).toUpperCase(),
      rawLocal: "0x" + terminal.localFlags.toString(16).toUpperCase(),
    };
    terminal.setRawMode(false);

    // Spawn a simple command through the PTY
    const proc = Bun.spawn(["echo", "hello from PTY"], { terminal });
    await proc.exited;

    // Wait briefly for terminal data callback
    await Bun.sleep(5);

    return jsonResponse({
      dimensions: { cols: 80, rows: 24 },
      flags,
      rawModeFlags: rawFlags,
      output: ptyOutput.trim(),
      closed: terminal.closed,
      note: "Bun.Terminal — PTY for interactive programs. termios flags expose control/input/local/output modes. setRawMode() disables line buffering and echo.",
    });
  } catch (e) {
    return jsonResponse({
      error: String(e),
      note: "Bun.Terminal requires a TTY-capable environment. PTY creation may fail in CI/non-TTY contexts.",
    });
  }
}
