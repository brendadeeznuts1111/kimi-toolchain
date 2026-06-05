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

echo ""
echo "Installed ${COUNT} wrapper(s) in ${BIN_DIR}"
echo "Ensure ~/.local/bin is on PATH."
