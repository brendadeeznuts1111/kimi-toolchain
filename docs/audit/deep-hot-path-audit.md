# Deep Hot-Path Audit — Supply Chain Security

> Scope: `postinstall.ts`, `kimi-guardian`, `sync-to-desktop`, `governance-preflight`, templates, and the `trustedDependencies` enforcement pipeline.

---

## 🔴 CRITICAL

### C1. `postinstall.ts` has no repo origin verification

**Hot path:** `src/install-hooks/postinstall.ts` → runs on every `bun install`/`bun install -g`

**Finding:** The script computes `REPO_ROOT = resolve(import.meta.dir, "../..")` and blindly calls `syncDesktop(REPO_ROOT, { force: true })`. If a user runs `bun install` from a malicious fork, the entire `~/.kimi-code/` runtime is overwritten with untrusted code. No canonical repo verification, no signature check, no hash validation.

**Impact:** Complete compromise of the live runtime (`~/.kimi-code/`) — tools, lib, scripts, MCP config, and SQLite DB.

**Fix:** Add a canonical-repo guard before sync. Verify `git remote` matches the known canonical URL, or require `KIMI_TOOLCHAIN_ROOT` env var for non-canonical installs.

---

### C2. `kimi-guardian` checks `bunfig.toml` for `trustedDependencies`, not `package.json`

**Hot path:** `src/bin/kimi-guardian.ts:354-401` → `checkTrustedDeps()`

**Finding:** The function reads `trustedDependencies` from `bunfig.toml` only. Bun's canonical location for this field is `package.json`. The root `package.json` now has `"trustedDependencies": []`, but `kimi-guardian` ignores it entirely. It also falls back to regex-parsing the TOML file (`trustedDependencies\s*=\s*\[([^\]]*)\]`) which is fragile and will break on multi-line arrays or comments.

**Impact:** `kimi-guardian check` reports false positives (all deps "untrusted" even when `package.json` correctly declares `trustedDependencies`). Users run `kimi-guardian fix` which auto-adds deps to `bunfig.toml`, defeating the explicit trust model.

**Fix:** Read `package.json` `trustedDependencies` as primary source. Use `bunfig.toml` `[install].trustedDependencies` as override only. Replace regex parsing with proper TOML parsing.

---

### C3. `kimi-guardian fix` auto-adds untrusted deps — fail-open behavior

**Hot path:** `src/bin/kimi-guardian.ts:675-687` → `fix` command

**Finding:** `kimi-guardian fix` calls `checkTrustedDeps()` to find deps with lifecycle scripts, then calls `addTrustedDeps()` to append them to `bunfig.toml`. This is automatic — no confirmation, no audit trail. A dependency with a `postinstall` script (e.g., a newly added attack vector) gets silently trusted.

**Impact:** Supply chain attack: malicious dependency with lifecycle script is auto-trusted by the fix command.

**Fix:** Require `--confirm` flag for `fix` to auto-add. Default behavior should be `report-only` with manual instructions. Or gate auto-add behind a `KIMI_GUARDIAN_AUTO_TRUST=1` env var.

---

### C4. `governance.ts` `refreshStaleLockfile` runs without `--frozen-lockfile`

**Hot path:** `src/lib/governance.ts:282` → `refreshStaleLockfile()`

**Finding:** The function runs `bun install --ignore-scripts` without `--frozen-lockfile`. Under the root `bunfig.toml` policy (`frozenLockfile = true`), this is redundant — Bun will respect the config. But if called from a context without the config (e.g., a template project), it could mutate the lockfile silently. Also, the function TOUCHES the lockfile (`await Bun.write(lockPath, await Bun.file(lockPath).text())`) to update mtime, which masks stale-lockfile detection.

**Impact:** Silent lockfile mutation during governance preflight. Mtime masking hides drift.

**Fix:** Add explicit `--frozen-lockfile` to the spawn args. Remove the TOUCH hack — if the lockfile is correct, the mtime is irrelevant; if it's stale, the install should fail loudly.

---

### C5. `governance-preflight.ts` auto-runs `kimi-guardian fix` (which auto-trusts deps)

**Hot path:** `src/lib/governance-preflight.ts:92-98` → `runGovernancePreflight()`

**Finding:** When `lockfileNeedsGuardianBaseline()` returns true, it runs `kimi-guardian fix` which auto-adds untrusted deps. This is called during pre-push and `kimi-governance score --preflight`. The pre-push hook is the LAST line of defense before code enters the remote — it should not silently mutate security policy.

**Impact:** Pre-push auto-whitelists lifecycle scripts, bypassing explicit trust.

**Fix:** Replace `kimi-guardian fix` with `kimi-guardian check` in preflight. Only baseline the hash, never auto-add trusted deps. Emit a warning if untrusted deps are found.

---

## 🟠 HIGH

### H1. Template `package.json` files lack `trustedDependencies`

**Hot path:** `templates/bun-create/*/package.json` — 5 templates, all missing the field

**Finding:** `herdr-service-template`, `kimi-toolchain`, `kimi-gates`, `kimi-dashboard`, and `artifact-portal-convergence` all lack `trustedDependencies` in their `package.json`. When a user runs `bun create` from these templates, the new project has no explicit trust policy. The `bunfig.toml` has `[install].trustedDependencies = []`, but `package.json` is the canonical Bun location.

**Impact:** New projects inherit an implicit trust policy (Bun default) rather than explicit fail-closed.

**Fix:** Add `"trustedDependencies": []` to every template `package.json`.

---

### H2. `check-templates.ts` doesn't verify `trustedDependencies`

**Hot path:** `scripts/check-templates.ts` — CI gate for template validation

**Finding:** The script checks two things: (1) zero dependencies, (2) postinstall script present. It does NOT check for `trustedDependencies` in `package.json`. This means a template could ship without the field and CI would pass.

**Impact:** Templates with missing security policy pass CI undetected.

**Fix:** Add a check: every template `package.json` must have `"trustedDependencies"` as an array (even if empty).

---

### H3. `install-bin-wrappers.sh` runs during postinstall without content validation

**Hot path:** `scripts/install-bin-wrappers.sh` → called from `postinstall.ts:52-62`

**Finding:** The script reads `package.json` from the repo, extracts `pkg.bin`, and writes shell scripts to `~/.local/bin/`. It uses `bun -e` to parse the JSON and then iterates over `pkg.bin` keys. If `package.json` is tampered with, arbitrary wrappers are installed on PATH. The script itself is run via `Bun.spawn(["bash", wrapperScript])` — no validation that the script hasn't been modified.

**Impact:** Arbitrary PATH wrapper injection during install.

**Fix:** Add a hash check for `install-bin-wrappers.sh` before execution, or inline the wrapper generation in TypeScript instead of shell.

---

### H4. `sync-to-desktop.ts` copies files without integrity verification

**Hot path:** `scripts/sync-to-desktop.ts` → `syncDesktop()` / `syncBunCreateMirror()`

**Finding:** `syncDesktop` copies ALL `src/lib/**/*.ts`, `src/bin/*.ts`, `scripts/*.ts`, etc. to `~/.kimi-code/` using `copyIfChanged()` which only compares text content. There is no signature verification, no hash validation against a trusted manifest. A maliciously modified `src/lib/secrets-manager.ts` would be synced to the live runtime.

**Impact:** Repo compromise propagates to live runtime silently.

**Fix:** Before sync, verify the repo manifest against the last signed `kimi-guardian` manifest. If the manifest is invalid or missing, require `--force` flag.

---

## 🟡 MEDIUM

### M1. ~~`doctor-trusted-deps.ts` and `check-template-policy.ts` only check `bunfig.toml`~~ (resolved)

**Hot path:** `src/lib/doctor-trusted-deps.ts`, `src/lib/template-policy-audit.ts` (`scripts/check-template-policy.ts`)

**Status:** Fixed. `doctor-trusted-deps.ts` reads root `package.json` `trustedDependencies` as primary. `template-policy-audit.ts` audits root and every `templates/bun-create/*/package.json` for explicit `trustedDependencies` arrays, plus `bunfig.toml` install parity.

---

### M2. `kimi-guardian` signing key fallback is weak

**Hot path:** `src/bin/kimi-guardian.ts:215-244` → `getSigningKey()` / `createSigningKey()`

**Finding:** On macOS, the key is stored in Keychain (good). On Linux or when Keychain fails, it falls back to `~/.kimi-code/guardian/.key` with `chmod 600`. No encryption, no key derivation. If the file is readable by any process running as the user, the manifest can be forged.

**Fix:** Use `Bun.CryptoHasher` with a user-derived key (e.g., HMAC of machine ID + repo path) instead of a stored secret. Or use OS keyring via `keyring` library on Linux.

---

### M3. Multiple `bun install` without `--frozen-lockfile` in codebase

**Hot path:** `src/lib/governance.ts:282`, `scripts/install-herdr-plugin.sh:25`

**Finding:** `governance.ts` runs `bun install --ignore-scripts` (missing `--frozen-lockfile`). `install-herdr-plugin.sh` runs plain `bun install`. Both could mutate lockfiles.

**Fix:** Use `bun install --frozen-lockfile` everywhere except explicit dependency-change workflows.

---

## Summary Table

| #   | Finding                                                 | Severity    | File                                                                 | Fix                            |
| --- | ------------------------------------------------------- | ----------- | -------------------------------------------------------------------- | ------------------------------ |
| C1  | No repo origin verification in postinstall              | 🔴 CRITICAL | `src/install-hooks/postinstall.ts`                                   | Canonical repo guard           |
| C2  | `kimi-guardian` checks `bunfig.toml` not `package.json` | 🔴 CRITICAL | `src/bin/kimi-guardian.ts`                                           | Read `package.json` first      |
| C3  | `kimi-guardian fix` auto-trusts deps                    | 🔴 CRITICAL | `src/bin/kimi-guardian.ts`                                           | Require confirmation           |
| C4  | `governance.ts` missing `--frozen-lockfile`             | 🔴 CRITICAL | `src/lib/governance.ts`                                              | Add flag, remove TOUCH         |
| C5  | Preflight auto-runs `kimi-guardian fix`                 | 🔴 CRITICAL | `src/lib/governance-preflight.ts`                                    | Replace with `check`           |
| H1  | Templates lack `trustedDependencies`                    | 🟠 HIGH     | `templates/bun-create/*/package.json`                                | Add field                      |
| H2  | `check-templates.ts` misses `trustedDependencies`       | 🟠 HIGH     | `scripts/check-templates.ts`                                         | Add check                      |
| H3  | `install-bin-wrappers.sh` unvalidated                   | 🟠 HIGH     | `scripts/install-bin-wrappers.sh`                                    | Hash check or inline           |
| H4  | Sync copies files without integrity                     | 🟠 HIGH     | `scripts/sync-to-desktop.ts`                                         | Manifest verification          |
| M1  | ~~New checks only verify `bunfig.toml`~~ (resolved)     | ✅ FIXED    | `src/lib/doctor-trusted-deps.ts`, `src/lib/template-policy-audit.ts` | `package.json` + bunfig parity |
| M2  | Signing key fallback weak                               | 🟡 MEDIUM   | `src/bin/kimi-guardian.ts`                                           | Derive key or use OS keyring   |
| M3  | Missing `--frozen-lockfile`                             | 🟡 MEDIUM   | `src/lib/governance.ts`, `scripts/install-herdr-plugin.sh`           | Add flag                       |

---

## Next: Implementing the Patches

Priority order: C5 → C4 → C2 → C3 → H1 → H2 → M1 → M3

(C1 and H3/H4 are architectural changes requiring design decisions; the rest are surgical fixes.)
