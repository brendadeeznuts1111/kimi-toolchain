# Local Documentation Patches

| Patch | Target | Status | Apply |
|-------|--------|--------|-------|
| docs-patch-bun-openineditor.patch | oven-sh/bun docs/runtime/utils.mdx | SUBMITTED PR [#32603](https://github.com/oven-sh/bun/pull/32603) | `git apply docs-patch-bun-openineditor.patch` |
EOF && git add docs-patch-bun-openineditor.patch docs-patches/README.md && git commit -m "docs: local patch for Bun.openInEditor URL + editor values" && echo "✅ Patch tracked locally on main"
