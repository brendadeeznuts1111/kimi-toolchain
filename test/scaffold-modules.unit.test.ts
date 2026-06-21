import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists, removePath } from "../src/lib/bun-io.ts";
import { parseKimiModules, scaffoldKimiModules } from "../src/lib/scaffold-modules.ts";

const TMP = join(import.meta.dir, ".tmp-scaffold-modules");

function resetTmp(): void {
  removePath(TMP, { recursive: true, force: true });
}

beforeEach(() => resetTmp());
afterEach(() => resetTmp());

describe("scaffold-modules", () => {
  test("parseKimiModules accepts db and terminal", () => {
    expect(parseKimiModules({ KIMI_MODULES: "db,terminal" })).toEqual(["db", "terminal"]);
  });

  test("scaffoldKimiModules writes db processor", async () => {
    await Bun.write(join(TMP, "package.json"), JSON.stringify({ name: "db-demo", scripts: {} }));

    const result = await scaffoldKimiModules(TMP, ["db"], false);

    expect(result.modules).toEqual(["db"]);
    const processor = join(TMP, "src/effect/db/processor.ts");
    expect(result.filesWritten).toContain(processor);
    expect(pathExists(processor)).toBe(true);
    const init = await Bun.file(join(TMP, "src/init.ts")).text();
    expect(init).toContain("kimi.effect.db");
  });

  test("scaffoldKimiModules writes terminal processor", async () => {
    await Bun.write(join(TMP, "package.json"), JSON.stringify({ name: "term-demo", scripts: {} }));

    const result = await scaffoldKimiModules(TMP, ["terminal"], false);

    expect(result.modules).toEqual(["terminal"]);
    const processor = join(TMP, "src/effect/terminal/processor.ts");
    expect(result.filesWritten).toContain(processor);
    expect(pathExists(processor)).toBe(true);
    const init = await Bun.file(join(TMP, "src/init.ts")).text();
    expect(init).toContain("kimi.effect.terminal");
  });
});
