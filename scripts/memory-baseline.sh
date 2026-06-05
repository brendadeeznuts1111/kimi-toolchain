#!/usr/bin/env bash
# Capture memory baseline metrics (before/after tuning or reboot).
set -euo pipefail
OUT="${1:-/tmp/memory-baseline.txt}"
{
  echo "=== BASELINE $(date) ==="
  uptime
  vm_stat | grep -E "Pages free|Swap"
  sysctl vm.swapusage 2>/dev/null || true
  memory_pressure -Q 2>/dev/null || true
  ps -axo rss,comm | awk '{s+=$1} END {printf "RSS total: %.1f GB\n", s/1024/1024}'
} >> "$OUT"
cat "$OUT"
