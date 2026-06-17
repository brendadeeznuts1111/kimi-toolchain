import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { safeToml } from "./utils.ts";

export interface PropertyTableDxConfig {
  file?: string;
  class?: string;
  output?: string;
}

export interface ResolvedPropertyTableInput {
  projectRoot: string;
  file: string;
  className: string;
  output: string;
  source: "cli" | "dx.config.toml" | "default";
}

function isPropertyTableDxConfig(value: unknown): value is PropertyTableDxConfig {
  if (value == null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.file != null && typeof row.file !== "string") return false;
  if (row.class != null && typeof row.class !== "string") return false;
  if (row.output != null && typeof row.output !== "string") return false;
  return true;
}

export async function readPropertyTableDxConfig(
  projectRoot: string
): Promise<PropertyTableDxConfig> {
  const path = join(projectRoot, "dx.config.toml");
  if (!pathExists(path)) return {};
  const parsed = safeToml(
    await Bun.file(path).text(),
    {},
    (value): value is Record<string, unknown> => value != null && typeof value === "object"
  );
  const dx = parsed.dx;
  if (dx == null || typeof dx !== "object") return {};
  const block = (dx as Record<string, unknown>).propertyTable;
  return isPropertyTableDxConfig(block) ? block : {};
}

export interface PropertyTableCliArgs {
  file?: string;
  className?: string;
  output?: string;
}

export function resolvePropertyTableInput(
  projectRoot: string,
  cli: PropertyTableCliArgs,
  dx: PropertyTableDxConfig
): ResolvedPropertyTableInput {
  const file = cli.file ?? dx.file;
  const className = cli.className ?? dx.class;
  if (!file || !className) {
    throw new Error(
      "Missing --file and --class (or [dx.propertyTable] file + class in dx.config.toml)"
    );
  }

  const output =
    cli.output ??
    dx.output ??
    join(projectRoot, "docs", `table-${className.replace(/\./g, "-")}.md`);

  let source: ResolvedPropertyTableInput["source"] = "default";
  if (cli.file || cli.className || cli.output) source = "cli";
  else if (dx.file || dx.class) source = "dx.config.toml";

  return {
    projectRoot,
    file,
    className,
    output,
    source,
  };
}
