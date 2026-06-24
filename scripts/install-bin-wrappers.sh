#!/usr/bin/env bash
# Install kimi-toolchain meta wrapper + legacy dispatch aliases on PATH.
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
TOOLS_DIR="${HOME}/.kimi-code/tools"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$BIN_DIR"

# Prefer stable install path — avoid ephemeral /private/tmp/bun-node-* from command -v
BUN="${BUN_INSTALL:-${HOME}/.bun}/bin/bun"
if [[ ! -x "${BUN}" ]]; then
  BUN="$(command -v bun || true)"
fi
if [[ -z "${BUN}" || ! -x "${BUN}" ]]; then
  echo "❌ bun not found; set BUN_INSTALL or add ~/.bun/bin to PATH" >&2
  exit 1
fi
META="kimi-toolchain"
META_SCRIPT="${TOOLS_DIR}/${META}.ts"

# Primary meta wrapper
cat > "${BIN_DIR}/${META}" <<EOF
#!/usr/bin/env bash
# ${META} — kimi-toolchain meta router (auto-generated)
exec ${BUN} run "\${HOME}/.kimi-code/tools/${META}.ts" "\$@"
EOF
chmod +x "${BIN_DIR}/${META}"
echo "  ✓ ${BIN_DIR}/${META}"

# unified-shell-bridge — direct MCP stdio (no router)
if [[ -f "${TOOLS_DIR}/unified-shell-bridge.ts" ]]; then
  cat > "${BIN_DIR}/unified-shell-bridge" <<EOF
#!/usr/bin/env bash
exec ${BUN} run "\${HOME}/.kimi-code/tools/unified-shell-bridge.ts" "\$@"
EOF
  chmod +x "${BIN_DIR}/unified-shell-bridge"
  echo "  ✓ ${BIN_DIR}/unified-shell-bridge"
fi

# Legacy kimi-* aliases dispatch through meta bin
BINS="$(bun -e "
  const pkg = await Bun.file('${REPO_ROOT}/package.json').json();
  console.log(Object.keys(pkg.bin || {}).filter(k => k.startsWith('kimi-') && k !== '${META}').join(' '));
")"

COUNT=1
for name in ${BINS}; do
  short="${name#kimi-}"
  dest="${BIN_DIR}/${name}"
  cat > "$dest" <<EOF
#!/usr/bin/env bash
# ${name} — dispatches to ${META} ${short} (auto-generated)
exec ${BUN} run "\${HOME}/.kimi-code/tools/${META}.ts" "${short}" "\$@"
EOF
  chmod +x "$dest"
  echo "  ✓ ${dest} → ${META} ${short}"
  COUNT=$((COUNT + 1))
done

# Remove stale wrappers not in expected set
EXPECTED=" ${META} unified-shell-bridge ${BINS} "
REMOVED=0
for dest in "${BIN_DIR}"/kimi-* "${BIN_DIR}/kimi-toolchain"; do
  [[ -e "$dest" ]] || continue
  name="$(basename "$dest")"
  if [[ "${EXPECTED}" != *" ${name} "* ]]; then
    rm -f "$dest"
    echo "  ✗ removed stale ${name}"
    REMOVED=$((REMOVED + 1))
  fi
done

echo ""
echo "Installed ${COUNT} wrapper(s) in ${BIN_DIR} (${META} + aliases)"
if [[ "${REMOVED}" -gt 0 ]]; then
  echo "Removed ${REMOVED} stale wrapper(s)"
fi
echo "Ensure ~/.local/bin is on PATH."
