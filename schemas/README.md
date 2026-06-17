# Table output schemas (`dx:table --schema`)

Row/column contracts validated **after** `property-table-run` post-processing (`-u`, `--exact`, `--add-metadata`, `--columns`, etc.) and **before** emit.

| File | Table | Required flags | Purpose |
| ---- | ----- | -------------- | ------- |
| `endpoints.schema.toml` | `endpoints` | `-u --exact` | Protocol, hostname, URL shape, optional port bounds |
| `endpoints-strict.schema.toml` | `endpoints` | `-u --exact` | Pathname must not contain `..` |

## Fixture

`test/fixtures/dx-url-endpoints.toml` — three rows:

| name | url highlights |
| ---- | -------------- |
| `users` | port `8443`, query `?status=active`, hash `#main` |
| `health` | default HTTPS port (no explicit port column value) |
| `staging` | subdomain host, port `8443` |

## `endpoints.schema.toml`

Required columns: `name`, `url`, `url_protocol`, `url_hostname`.

| Column | Rule |
| ------ | ---- |
| `name` | string, length 1–128 |
| `url` | pattern `^https?://` |
| `url_protocol` | enum `https:` \| `http:` |
| `url_hostname` | string, length 1–253 |
| `url_port` | integer 1–65535 (when present) |

## `endpoints-strict.schema.toml`

Required columns: `name`, `url_pathname`.

| Column | Rule |
| ------ | ---- |
| `url_pathname` | custom: `value.startsWith('/') && !value.includes('..')` |

## Verify

```bash
bun run dx:table:contract
```

Runs the same pipeline as `test/table-schema.unit.test.ts` (prepare + validate, no table stdout).

CLI spot-check:

```bash
bun run dx:table extract test/fixtures/dx-url-endpoints.toml endpoints -u --exact \
  --schema schemas/endpoints.schema.toml --format table
```

Add `--schema-warn` to log violations without failing.

Docs: [docs/dx-table.md](../docs/dx-table.md)