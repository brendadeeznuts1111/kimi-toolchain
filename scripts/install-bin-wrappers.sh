#!/usr/bin/env bash
# Install thin PATH wrappers for kimi-toolchain bin entries.
# Each wrapper execs: bun run ~/.kimi-code/tools/<tool>.ts "$@"
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
TOOLS_DIR="${HOME}/.kimi-code/tools"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$BIN_DIR"

# Read bin keys from package.json
BINS="$(bun -e "
  const pkg = await Bun.file('${REPO_ROOT}/package.json').json();
  console.log(Object.keys(pkg.bin || {}).join(' '));
")"

if [[ -z "${BINS}" ]]; then
  echo "No bin entries in package.json"
  exit 1
fi

BUN="$(command -v bun || echo bun)"
COUNT=0

for name in ${BINS}; do
  dest="${BIN_DIR}/${name}"
  cat > "$dest" <<EOF
#!/usr/bin/env bash
# ${name} — kimi-toolchain wrapper (auto-generated)
exec ${BUN} run "\${HOME}/.kimi-code/tools/${name}.ts" "\$@"
EOF
  chmod +x "$dest"
  echo "  ✓ ${dest}"
  COUNT=$((COUNT + 1))
done

# Remove stale wrappers from prior package names / removed tools
REMOVED=0
for dest in "${BIN_DIR}"/kimi-*; do
  [[ -e "$dest" ]] || continue
  name="$(basename "$dest")"
  if [[ " ${BINS} " != *" ${name} "* ]]; then
    rm -f "$dest"
    echo "  ✗ removed stale ${name}"
    REMOVED=$((REMOVED + 1))
  fi
done

echo ""
echo "Installed ${COUNT} wrapper(s) in ${BIN_DIR}"
if [[ "${REMOVED}" -gt 0 ]]; then
  echo "Removed ${REMOVED} stale wrapper(s)"
fi
echo "Ensure ~/.local/bin is on PATH."
