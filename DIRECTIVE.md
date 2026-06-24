# Codebase Preservation Protocol

> Bun-native canonicalization, adversarial excision, and agent commit metadata.
> Agents: load this at session start. Enforcement: `bun run check:deletion-metric`, `bun run audit:full`.

## I. PRIME ETHOS

Entropy compounds; so must discipline. Default is to under-do pruning, native tuning, and gap-closing because they feel like a pure speed tax. Override that instinct. Execute 10× more silent, obsessive canonicalization than feels reasonable.

**Deletion is the primary deliverable.** Every protocol response must demonstrate net negative lines.

---

## II. OPERATIONAL LAWS

### Law 1: Bun-Native Absolutism

Bind strictly to Bun-native direct types, properties, and APIs. Zero needless abstractions. If Bun does it natively, the native path is the only acceptable path.

**Concrete violations (auto-fail):**

- `import { readFileSync } from "node:fs"` in new async code
- `readTextAsync(path)` wrapper when `await Bun.file(path).text()` works
- `JSON.parse(await Bun.file(path).text())` when `await Bun.file(path).json()` works
- `crypto.createHash("crc32")` when `Bun.hash.crc32()` exists
- Manual gzip when `new Bun.Archive(data, { compress: "gzip" })` exists

**8-file native alignment:**

| 8-file slot | Native API | Forbidden wrapper |
| --- | --- | --- |
| Core | `Bun.file`, `Bun.write`, `Bun.Archive`, `Bun.JSONC.parse`, `Bun.hash.crc32`, `Bun.TOML.parse` | `bun-io.ts` async aliases in new code |
| Core | `Bun.Glob` + `scanSync({ cwd })` | `node:fs/promises` `readdir` + manual walk |
| Core | `Bun.$\`cmd\`` | `child_process`, `execa` |
| Core | `Bun.build({ metafile: true })` | `esbuild` direct |
| Core | `Bun.serve`, `Bun.udpSocket` | `node:http`, `node:net` |
| Core | `Bun.s3` / `Bun.S3Client` | `aws-sdk`, `minio` |
| Core | `Bun.randomUUIDv7` | `crypto.randomUUID` |
| Metrics | `Bun.inspect.table`, `Bun.inspect` | `console.table` (use `Bun.inspect.table` for ANSI) |
| Final | `Bun.argv`, `Bun.env` | `process.argv`, `process.env` (migrate to `Bun.env` v1.3.7+) |
| Herdr | `Bun.listen`, `Bun.connect` | `node:net` sockets |

### Law 2: Adversarial Refactoring

Actively attack complexity. Delete code, merge modules, canonicalize patterns, excise indirection.

**Autophagy targets (weekly scan):**

- Wrappers with < 3 call sites → inline
- Files with < 50 lines and 1 export → merge into parent
- `index.ts` barrel files → delete, import direct
- Type aliases that mirror native types → delete, use native
- `utils.ts` grab-bags → split by domain or delete

### Law 3: Infra-Aligned Perf

Optimize strictly for your infrastructure. Close project gaps. No theoretical optimizations.

**Empirical targets only:**

- `Bun.hash.crc32` — 20× faster, use for archive baselines
- `Bun.Archive` — native tar, use for sync distribution
- `Bun.JSONC.parse` — parse tsconfig with comments, no regex hacks
- `Bun.serve` — HTTP proxy, use for herdr dashboard
- `Bun.s3` — R2 KPI exports, use native over SDK

### Law 4: The Unglamorous Multiplier

When you feel you have done enough pruning, tuning, or gap-closing, do 10× more.

---

## III. EFFECT LAYER (Mandatory Manifestation)

Every protocol response must demonstrate compliance.

### 1. Deletion Metric

Delete/consolidate at least 3× more than you add. Favor atomic deletions over additions.

**Enforcement:**

```bash
bun run check:deletion-metric          # working tree vs HEAD
bun run check:deletion-metric --staged # index vs HEAD (pre-commit)
bun run agent:commit --enforce-deletion "feat: ..."
```

### 2. Abstraction Audit

Explicitly justify why a direct Bun-native API was insufficient for any new abstraction. If unjustified, revert to native.

**Template (required in PR description):**

```
Abstraction: [function name]
Justification: [why Bun-native API insufficient]
Native alternative: [what was rejected]
```

### 3. Gap-Close Rule

No partial implementations. Close gaps entirely. **Zero TODOs, zero placeholders, zero future-proofing scaffolding** in changed files.

**Enforcement (changed files only):**

```bash
bun run audit:phase4
```

### 4. Un-wrapping Protocol

Delete wrappers/helpers that merely obscure direct Bun API calls. Inline the native call.

**Auto-detect:**

```bash
bun run audit:phase1   # includes wrapper proxy scan
```

### 5. The 10× Adversarial Pass

Before outputting, silently re-read your diff. Ask: *"What would a ruthless reviewer delete?"* Delete it.

---

## IV. ORDER OF OPERATIONS

Execute in this exact sequence. **Do not skip phases.**

### Phase 1: AUDIT

Identify dead code, unnecessary abstractions, and project gaps. State what must die.

**Output format:**

```
[AUDIT] Phase 1 — Targets for excision:
- src/lib/legacy-wrapper.ts (3 call sites, inlineable)
- src/lib/utils.ts:parseJson() (Bun.file().json() native)
- src/lib/config-loader.ts:readTsconfig() (Bun.JSONC.parse native)
- Gap: Bun.hash.crc32 not used in archive-persistence.ts
```

```bash
bun run audit:phase1
```

### Phase 2: EXCISE

Delete wrappers, indirection, and unused modules. **Do not write new code yet.**

**Output format:**

```
[EXCISE] Phase 2 — Deleted:
- src/lib/legacy-wrapper.ts (-47 lines)
- src/lib/utils.ts:parseJson() (-12 lines)
- Merged src/lib/foo-helpers.ts into src/lib/foo.ts (-89 lines)
```

```bash
bun run audit:phase2              # validates net-negative diff
bun run audit:phase2 --approve    # human gate cleared; proceed to phase 3
```

### Phase 3: NATIVE-ALIGN

Replace abstracted calls with direct Bun-native APIs.

**Output format:**

```
[NATIVE-ALIGN] Phase 3 — Inlined:
- src/lib/archive-persistence.ts:hashArchive() → Bun.hash.crc32() (-8 lines, -1 dependency)
- src/lib/config-loader.ts → Bun.JSONC.parse() (-15 lines, -1 regex)
```

```bash
bun run audit:phase3
```

### Phase 4: GAP-CLOSE

Implement the missing infra-bound perf optimizations completely.

**Output format:**

```
[GAP-CLOSE] Phase 4 — Implemented:
- Bun.hash.crc32 in archive-persistence.ts (+6 lines, -1 import)
- Bun.Glob.scanSync({ cwd }) in scanTreeSync() (-12 lines, -1 node:fs import)
```

```bash
bun run audit:phase4
```

### Phase 5: ADVERSARIAL PASS

Execute the 10× review. Force the Deletion Metric.

**Output format:**

```
[ADVERSARIAL] Phase 5 — Survivorship audit:
- kept src/lib/bun-release-registry.ts (SSOT, 8 consumers)
- kept src/lib/archive-persistence.ts (Bun.Archive round-trip, tested)
- DELETED src/lib/bun-io.ts:readJson<T>() (replaced by Bun.file().json() + Zod)
- DELETED src/lib/hash-utils.ts (Bun.hash.crc32 native)

[DIFF METRICS]
Lines added: 23
Lines deleted: 147
Wrappers removed: 3
Bun APIs inlined: 4
Deletion ratio: 6.4× ✅
```

```bash
bun run audit:phase5
bun run audit:full   # phases 1–5 sequentially
```

---

## V. ENFORCEMENT MECHANICS

### 1. Deletion Receipt (Required)

End every protocol response with:

```
[DIFF METRICS]
Lines added: [N]
Lines deleted: [N]
Wrappers removed: [N]
Bun APIs inlined: [N]
Deletion ratio: [N]× [✅/❌]
```

If ratio < 3.0×, redo the task.

### 2. Ban Defensive Programming

No pre-emptive error handling unless strictly required by infra. No generic utility classes. If a function is used once, inline it.

### 3. Zero Conversational Filler

No apologies. No explanations of what you *didn't* do. Output only: **Audit, Code, Diff Metrics.**

### 4. Atomic Phase Gates

When the human says: *"Execute Phase 1 (AUDIT) and Phase 2 (EXCISE) only. Do not write new code yet. Wait for approval."*

The agent must not proceed to Phase 3 until explicitly approved (`audit:phase2 --approve` or `KIMI_PHASE2_APPROVED=1`).

### 5. Survivorship Audit

Before final output, append:

```
[SURVIVORSHIP AUDIT]
- kept [file/function]: [one sentence proving deletion breaks infra]
- deleted [file/function]: [justification]
```

If you cannot prove a kept function is essential, delete it.

### 6. Contextual Anchoring

Every 10 turns, re-inject:

> *Reminder: Is this the absolute most direct Bun-native implementation? If there is a wrapper, inline it. If there is an abstraction, flatten it.*

---

## VI. AGENT COMMIT METADATA

Every agent commit must include:

```
[agent-meta]
session: [KIMI_SESSION_ID]
zone: [active zone, e.g., sports-terminal, kimi-toolchain]
directive: [protocol version, e.g., v1.0.0]
phases: [1,2,3,4,5] or [1,2] if partial
deletion-ratio: [N]×
```

**Example:**

```
feat: archive baseline drift detection

[agent-meta]
session: agent-20260624-1057
zone: kimi-toolchain
directive: v1.0.0
phases: [1,2,3,4,5]
deletion-ratio: 6.4x

Signed-off-by: nolarose <nolarose@factory-wager.com>
Co-authored-by: kimi-agent <agent@kimi.factory-wager.com>
```

```bash
KIMI_DIRECTIVE_VERSION=v1.0.0 KIMI_DIRECTIVE_PHASES=1,2,3,4,5 \
  bun run agent:commit --enforce-deletion "feat: archive baseline drift detection"
```

---

## VII. 8-FILE ARCHITECTURE ALIGNMENT

| Protocol phase | Maps to 8-file slot | Rule |
| --- | --- | --- |
| Phase 1 AUDIT | **Metrics** | Identify dead code, measure coverage |
| Phase 2 EXCISE | **Scaffold** | Delete templates, merge stubs |
| Phase 3 NATIVE-ALIGN | **Core** | Inline Bun APIs, delete wrappers |
| Phase 4 GAP-CLOSE | **Harness** | Wire orchestration, close loops |
| Phase 5 ADVERSARIAL | **Profile** | CLI validation, final gate |

---

## VIII. QUICK COMMANDS

```bash
# Deletion metric (3.0× minimum by default)
bun run check:deletion-metric
bun run check:deletion-metric --staged --min-ratio 3

# Full protocol gate
bun run audit:full

# Phase-gated (human approval between)
bun run audit:phase1
bun run audit:phase2
bun run audit:phase2 --approve   # required before phase 3+
bun run audit:phase3
bun run audit:phase4
bun run audit:phase5

# Supporting scans (also run inside phase 1)
bun run autophagy:scan
bun run deep-native:scan
bun run scripts/lint-bun-native.ts --report
```

---

_v1.0.0 — kimi-toolchain repo root SSOT_