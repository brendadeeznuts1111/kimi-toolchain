#!/usr/bin/env bash
# Bootstrap low-latency GitHub git: SSH multiplexing + optional HTTPS→SSH remote switch.
set -euo pipefail

SSH_DIR="${HOME}/.ssh"
SSH_CONFIG="${SSH_DIR}/config"
CONTROL_DIR="${SSH_DIR}/sockets"
CANONICAL_HOST="github.com-personal"
DEFAULT_IDENTITY="${HOME}/.ssh/id_ed25519"

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap-git-ssh.sh [--warm] [--switch-remote]

  --warm            Open a multiplexed SSH session to GitHub (ControlPersist)
  --switch-remote   Point origin at git@github.com-personal:<owner>/<repo>.git when on HTTPS

Idempotent: safe to re-run. Does not overwrite unrelated ~/.ssh/config stanzas.
EOF
}

WARM=0
SWITCH_REMOTE=0
for arg in "$@"; do
  case "${arg}" in
    --warm) WARM=1 ;;
    --switch-remote) SWITCH_REMOTE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: ${arg}" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "${SSH_DIR}" "${CONTROL_DIR}"
chmod 700 "${SSH_DIR}" "${CONTROL_DIR}"

MUX_BLOCK=$'# GitHub SSH multiplexing (kimi-toolchain bootstrap-git-ssh)\n\tControlMaster auto\n\tControlPath ~/.ssh/sockets/control-%r@%h:%p\n\tControlPersist 10m\n\tServerAliveInterval 60\n'

if [[ ! -f "${SSH_CONFIG}" ]]; then
  cat >"${SSH_CONFIG}" <<EOF
Host *
	IdentityAgent "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
	AddKeysToAgent yes
	IdentitiesOnly yes

Host github.com github.com-personal github-primary github.com-1p github-secondary
	HostName github.com
	User git
${MUX_BLOCK}
EOF
  chmod 600 "${SSH_CONFIG}"
  echo "✓ Created ${SSH_CONFIG} with GitHub multiplexing"
else
  if ! grep -q 'kimi-toolchain bootstrap-git-ssh' "${SSH_CONFIG}" 2>/dev/null; then
    {
      echo ""
      echo "# GitHub SSH multiplexing (kimi-toolchain bootstrap-git-ssh)"
      echo "Host github.com github.com-personal github-primary github.com-1p github-secondary"
      echo "	HostName github.com"
      echo "	User git"
      printf '%b' "${MUX_BLOCK}"
    } >>"${SSH_CONFIG}"
    echo "✓ Appended GitHub multiplexing block to ${SSH_CONFIG}"
  else
    echo "↷ GitHub multiplexing already present in ${SSH_CONFIG}"
  fi
fi

if [[ -f "${DEFAULT_IDENTITY}" ]]; then
  if ! grep -A20 'Host github.com-personal' "${SSH_CONFIG}" | grep -q 'IdentityFile' 2>/dev/null; then
    echo "  ℹ github.com-personal should set IdentityFile ${DEFAULT_IDENTITY} for brendadeeznuts1111"
  fi
fi

if [[ "${WARM}" -eq 1 ]]; then
  echo "→ Warming SSH (git@${CANONICAL_HOST})…"
  ssh -o BatchMode=yes -T "git@${CANONICAL_HOST}" 2>&1 | head -3 || true
fi

if [[ "${SWITCH_REMOTE}" -eq 1 ]]; then
  REPO_ROOT="$(bash "$(dirname "$0")/resolve-repo-root.sh")"
  cd "${REPO_ROOT}"
  ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "${ORIGIN}" == https://github.com/* ]]; then
    PATH_PART="${ORIGIN#https://github.com/}"
    PATH_PART="${PATH_PART%.git}"
    NEW_URL="git@${CANONICAL_HOST}:${PATH_PART}.git"
    git remote set-url origin "${NEW_URL}"
    echo "✓ origin → ${NEW_URL}"
  elif [[ -n "${ORIGIN}" ]]; then
    echo "↷ origin already non-HTTPS: ${ORIGIN}"
  else
    echo "⚠ no origin remote configured"
  fi
fi

echo ""
echo "Next: time git push origin HEAD   # repeated pushes reuse the mux socket"