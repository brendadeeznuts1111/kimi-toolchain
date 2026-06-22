#!/bin/bash
# check-docs.sh — Verify .md files follow style guide conventions
# Usage: bash scripts/check-docs.sh [directory]
# Exit code: number of errors (0 = clean)
#
# Color coding (HSL → HEX → ANSI 256):
#   ERROR  red     hsl(0,80%,55%)  #E63946  → ANSI 196
#   WARN   amber   hsl(35,90%,55%) #F4A024  → ANSI 214
#   INFO   blue    hsl(210,70%,60%)#4DA6FF  → ANSI 75
#   OK     green   hsl(145,60%,50%)#33CC66  → ANSI 77
#   DIM    gray    hsl(0,0%,50%)   #808080  → ANSI 244
#   BOLD   white   hsl(0,0%,100%)  #FFFFFF  → ANSI 15

set -uo pipefail

root="${1:-.}"

# ANSI 256-color codes (derived from HSL/HEX values above)
C_ERROR="\033[38;5;196m"
C_WARN="\033[38;5;214m"
C_INFO="\033[38;5;75m"
C_OK="\033[38;5;77m"
C_DIM="\033[38;5;244m"
C_BOLD="\033[38;5;15m"
C_RESET="\033[0m"
C_HEADER="\033[38;5;39m"

# Counters
total_errors=0
total_warnings=0
total_files=0
total_clean=0

# Per-category counters
declare -A cat_errors
declare -A cat_warnings
declare -A cat_files

# Per-issue-type counters
declare -A issue_count

# Determine category from file path
get_category() {
  local f="$1"
  case "$f" in
    ./README.md|./AGENTS.md|./CHANGELOG.md|./CODE_REFERENCES.md|./CONTEXT.md|./CONTRIBUTING.md|./DEEP-QUALITY.md|./MACROS.md|./TEMPLATES.md|./UNIFIED.md|./INDEX.md)
      echo "root" ;;
    ./docs/adr/*) echo "adr" ;;
    ./docs/references/*) echo "references" ;;
    ./docs/plans/*) echo "plans" ;;
    ./docs/canvases/*) echo "canvases" ;;
    ./docs/describe/*) echo "sub-tables" ;;
    ./docs/groups/*) echo "sub-tables" ;;
    ./docs/*) echo "core" ;;
    ./examples/dashboard/*) echo "examples" ;;
    ./examples/gates/*) echo "examples" ;;
    ./examples/portal/*) echo "examples" ;;
    ./examples/trading-workspace/*) echo "examples" ;;
    ./examples/*) echo "examples" ;;
    ./skills/*) echo "skills" ;;
    ./templates/*) echo "templates" ;;
    ./schemas/*) echo "schemas" ;;
    ./test/*) echo "test" ;;
    ./src/*) echo "src" ;;
    *) echo "other" ;;
  esac
}

# Print a colored label
print_label() {
  local color="$1" label="$2"
  printf "${color}%-7s${C_RESET}" "$label"
}

# Collect results per file
declare -A grouped_output

while IFS= read -r f; do
  # Skip dependency caches, build artifacts, and hidden dirs
  case "$f" in
    */node_modules/*) continue ;;
    */.kimi-artifacts/*) continue ;;
    */.git/*) continue ;;
    */.bun/*) continue ;;
    */bun-install/*) continue ;;
    */.cache/*) continue ;;
    */dist/*) continue ;;
    */build/*) continue ;;
  esac

  cat=$(get_category "$f")
  total_files=$((total_files + 1))
  cat_files["$cat"]=$(( ${cat_files["$cat"]:-0} + 1 ))

  file_err=0
  file_warn=0
  file_issues=""

  # Check frontmatter
  if ! head -1 "$f" | grep -q '^---$'; then
    file_issues+="$(print_label "$C_ERROR" "ERROR"): ${C_DIM}$f${C_RESET} missing frontmatter (---)\n"
    file_err=$((file_err + 1))
    issue_count["frontmatter"]=$(( ${issue_count["frontmatter"]:-0} + 1 ))
  fi

  # Check for ## Related section
  if ! grep -q '^## Related' "$f"; then
    file_issues+="$(print_label "$C_ERROR" "ERROR"): ${C_DIM}$f${C_RESET} missing '## Related' section\n"
    file_err=$((file_err + 1))
    issue_count["related"]=$(( ${issue_count["related"]:-0} + 1 ))
  fi

  # Check for tags in frontmatter
  if ! grep -q '^tags:' "$f"; then
    file_issues+="$(print_label "$C_WARN" "WARN"):  ${C_DIM}$f${C_RESET} missing 'tags' in frontmatter\n"
    file_warn=$((file_warn + 1))
    issue_count["tags"]=$(( ${issue_count["tags"]:-0} + 1 ))
  fi

  # Check for category in frontmatter
  if ! grep -q '^category:' "$f"; then
    file_issues+="$(print_label "$C_WARN" "WARN"):  ${C_DIM}$f${C_RESET} missing 'category' in frontmatter\n"
    file_warn=$((file_warn + 1))
    issue_count["category"]=$(( ${issue_count["category"]:-0} + 1 ))
  fi

  # Check for #find: anchors (optional but recommended)
  if ! grep -q '#find:' "$f"; then
    file_issues+="$(print_label "$C_INFO" "INFO"):  ${C_DIM}$f${C_RESET} has no #find: anchor (optional)\n"
    issue_count["find"]=$(( ${issue_count["find"]:-0} + 1 ))
  fi

  total_errors=$((total_errors + file_err))
  total_warnings=$((total_warnings + file_warn))
  cat_errors["$cat"]=$(( ${cat_errors["$cat"]:-0} + file_err ))
  cat_warnings["$cat"]=$(( ${cat_warnings["$cat"]:-0} + file_warn ))

  if [ "$file_err" -eq 0 ] && [ "$file_warn" -eq 0 ]; then
    total_clean=$((total_clean + 1))
  fi

  # Store issues grouped by category
  if [ -n "$file_issues" ]; then
    grouped_output["$cat"]+="$file_issues"
  fi

done < <(find "$root" -name '*.md' -type f | sort)

# Print results grouped by category
category_order=("root" "core" "adr" "references" "plans" "canvases" "sub-tables" "examples" "skills" "templates" "schemas" "test" "src" "other")

echo ""
printf "${C_HEADER}${C_BOLD}=== Documentation Quality Report ===${C_RESET}\n"
echo ""

for cat in "${category_order[@]}"; do
  if [ -z "${grouped_output[$cat]:-}" ]; then
    continue
  fi

  err=${cat_errors[$cat]:-0}
  warn=${cat_warnings[$cat]:-0}
  files=${cat_files[$cat]:-0}

  # Category header with status indicator
  if [ "$err" -gt 0 ]; then
    status_color="$C_ERROR"
    status_icon="✗"
  elif [ "$warn" -gt 0 ]; then
    status_color="$C_WARN"
    status_icon="⚠"
  else
    status_color="$C_OK"
    status_icon="✓"
  fi

  printf "${status_color}${status_icon}${C_RESET} ${C_BOLD}[%s]${C_RESET} ${C_DIM}(%d files, %d errors, %d warnings)${C_RESET}\n" \
    "$cat" "$files" "$err" "$warn"
  echo ""
  printf "${grouped_output[$cat]}"
  echo ""
done

# Print issue type breakdown
printf "${C_HEADER}${C_BOLD}=== Issues by Type ===${C_RESET}\n"
echo ""
printf "  ${C_BOLD}%-20s %s${C_RESET}\n" "Issue Type" "Count"
printf "  ${C_DIM}%-20s %s${C_RESET}\n" "----------" "-----"

for key in frontmatter related tags category find; do
  count=${issue_count[$key]:-0}
  if [ "$count" -eq 0 ]; then
    color="$C_OK"
  elif [ "$key" = "frontmatter" ] || [ "$key" = "related" ]; then
    color="$C_ERROR"
  else
    color="$C_WARN"
  fi
  printf "  ${color}%-20s %d${C_RESET}\n" "$key" "$count"
done
echo ""

# Print summary table
printf "${C_HEADER}${C_BOLD}=== Summary ===${C_RESET}\n"
echo ""
printf "  ${C_BOLD}Total files scanned:  %d${C_RESET}\n" "$total_files"
printf "  ${C_OK}Clean files:          %d${C_RESET}\n" "$total_clean"
printf "  ${C_ERROR}Total errors:         %d${C_RESET}\n" "$total_errors"
printf "  ${C_WARN}Total warnings:       %d${C_RESET}\n" "$total_warnings"
echo ""

# Per-category summary
printf "  ${C_BOLD}%-15s %8s %8s %8s${C_RESET}\n" "Category" "Files" "Errors" "Warns"
printf "  ${C_DIM}%-15s %8s %8s %8s${C_RESET}\n" "--------" "-----" "------" "-----"
for cat in "${category_order[@]}"; do
  files=${cat_files[$cat]:-0}
  if [ "$files" -eq 0 ]; then
    continue
  fi
  err=${cat_errors[$cat]:-0}
  warn=${cat_warnings[$cat]:-0}
  if [ "$err" -gt 0 ]; then
    err_color="$C_ERROR"
  else
    err_color="$C_OK"
  fi
  if [ "$warn" -gt 0 ]; then
    warn_color="$C_WARN"
  else
    warn_color="$C_OK"
  fi
  printf "  %-15s %8d ${err_color}%8d${C_RESET} ${warn_color}%8d${C_RESET}\n" \
    "$cat" "$files" "$err" "$warn"
done
echo ""

# Final verdict
if [ "$total_errors" -eq 0 ]; then
  printf "${C_OK}${C_BOLD}✓ All docs pass quality checks${C_RESET}\n"
else
  printf "${C_ERROR}${C_BOLD}✗ %d error(s) found — see above${C_RESET}\n" "$total_errors"
fi

exit "$total_errors"
