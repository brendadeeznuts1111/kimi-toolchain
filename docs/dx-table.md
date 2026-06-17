# dx:table — TOML property tables

Extract `dx.config.toml` sections (or TypeScript JSDoc classes) into aligned Markdown, CSV, or JSON.

**Entry:** `bun run dx:table` (aliases: `dx-table`, `dx:property-table` for TypeScript-only defaults)

**Library map:** `src/lib/toml-property-table.ts`, `property-table-run.ts`, `property-table-options.ts`, `property-table-renderer.ts`

**Help:** `bun run dx:table --help`

## Commands

| Command | Purpose |
| ------- | ------- |
| `extract <file.toml> <table.path>` | Single table from TOML |
| `extract --resolved <table.path>` | Same table from merged project config (global + `dx.config.toml`) |
| `extract <file.toml> --all` | Every registered TOML table |
| `extract --file <path.ts> --class <Name>` | JSDoc property table |
| `inventory <table.path> --roots <dir>,<dir>` | Merge same table across projects (CSV/JSON) |

Registered TOML paths: `endpoints`, `herdr.orchestrator`, `herdr.orchestrator.remote_hosts`, `herdr.orchestrator.handoff_rules`.

Both `extract` and `inventory` accept `--project <root>` (default: cwd).

## Formats (`--format`)

| Format | Output |
| ------ | ------ |
| `file` (default) | `docs/table-<slug>.md` + stderr preview hint (`bun <path>`) |
| `raw` / `markdown` | Markdown on stdout |
| `table` | `Bun.inspect.table` on stdout |
| `csv` | RFC 4180 on stdout |
| `json` | `{ title, sourceLabel, columns, rows }` on stdout |

## Post-process flags

| Flag | Behavior |
| ---- | -------- |
| `--exact` | Omit `SourceFile` / `LastModified`; also skips `--add-metadata` columns |
| `-u` / `--decompose-urls` | Append `url_protocol`, `url_hostname`, `url_port`, `url_pathname`, `url_search`, `url_hash` |
| `--hide-source-url` / `--no-source-url` | With `-u`, drop original `url` column |
| `--sort-by COL` | Sort rows (bare `--sort-by` uses first data column) |
| `--columns a,b` | Column projection (order preserved) |
| `--filter col=val` | Row filter (repeatable, AND) |
| `--no-header` | Omit CSV header row (`--format csv`) |
| `--group-by COL` | Split output (`docs/groups/` per value, or stdout sections with `---`) |
| `--transpose` | Flip columns ↔ rows (`Field` + one column per row) |
| `--describe --keys COL` | Key-indexed catalog → `docs/describe/table-<slug>.md` |
| `--add-metadata [fields]` | Repeat config scalars on every row (default: `schemaVersion,name,scope`) |
| `--schema <file>` | Validate output against TOML/JSON schema (`schemas/*.schema.toml`) |
| `--schema-warn` | Schema violations to stderr only |
| `--preview` | After file write, render markdown in terminal via `bun <file.md>` |
| `--legacy-ansi` | Optional `Bun.markdown.ansi` after file write |
| `--output <path>` | Explicit output file (not with `--group-by`) |
| `--out-dir <dir>` | Output directory (default: `docs/`, or `docs/groups/` / `docs/describe/` per mode) |

### `--add-metadata` column names

Pass **TOML dot-paths** in `--add-metadata`, not output column names. When a metadata field collides with row data (e.g. config `name` vs endpoint `name`), the output column is prefixed: `config.name`.

Requires a TOML table extract (positional table path). Skipped when `--exact` is set.

```bash
# Correct: field path "name" → column "config.name" when rows already have "name"
bun run dx:table extract dx.config.toml endpoints --format csv \
  --add-metadata schemaVersion,name,runtime.bunVersion \
  --columns name,url,schemaVersion,config.name,runtime.bunVersion
```

## Flag constraints

| Combination | Result |
| ----------- | ------ |
| `--describe` + `--group-by` / `--transpose` / `--add-metadata` | Error |
| `--describe` without `--keys COL` | Error |
| `--describe` + `--format table` or `csv` | Error (use `file`, `raw`/`markdown`, or `json`) |
| `--group-by` + `--format table` / `csv` / `json` | Error (use `file` or `raw`/`markdown`) |
| `--output` + `--group-by` | Error (one file per group) |
| `--add-metadata` on TypeScript `--class` extract | Error |
| `inventory` without `--add-metadata` | Error |
| `inventory` + `--describe` | Error |
| `inventory` + `--format` other than `csv` or `json` | Error |

## Schema contracts

| Schema | Validates |
| ------ | --------- |
| `schemas/endpoints.schema.toml` | Decomposed endpoint rows (`-u --exact`) |
| `schemas/endpoints-strict.schema.toml` | Pathname safety (`custom` expression: no `..`) |

Fixture: `test/fixtures/dx-url-endpoints.toml` (three `[[endpoints]]` rows with ports, query, hash).

Gate (CI / local):

```bash
bun run dx:table:contract
```

Per-extract check:

```bash
bun run dx:table extract test/fixtures/dx-url-endpoints.toml endpoints \
  -u --exact --schema schemas/endpoints.schema.toml --format table
```

See [schemas/README.md](../schemas/README.md) for column rules.

## Examples

```bash
# Terminal inspection
bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format table

# Merged config (no explicit file path)
bun run dx:table extract --resolved endpoints --format table

# Markdown file + native preview
bun run dx:table extract dx.config.toml endpoints --exact --preview

# URL parts + CSV
bun run dx:table extract dx.config.toml endpoints -u --format csv --exact

# Filtered projection
bun run dx:table extract dx.config.toml endpoints -u --format csv \
  --columns name,url_hostname,url_port --filter name=users --exact

# Grouped files
bun run dx:table extract dx.config.toml endpoints -u --group-by url_hostname --exact

# Describe catalog
bun run dx:table extract dx.config.toml endpoints --describe --keys name --exact

# Multi-repo inventory (default format csv)
bun run dx:table inventory endpoints --roots .,../other \
  --add-metadata schemaVersion,name \
  --columns name,url,schemaVersion,config.name

# TypeScript JSDoc (or dx:property-table alias)
bun run dx:table extract --file src/lib/foo.ts --class AppConfig --format table
```

## Output paths

| Mode | Default path |
| ---- | ------------ |
| Table file | `docs/table-<slug>.md` |
| Group-by file | `docs/groups/table-<slug>-<key>.md` |
| Describe | `docs/describe/table-<slug>.md` |

Override with `--out-dir` or `--output` (not with `--group-by`).