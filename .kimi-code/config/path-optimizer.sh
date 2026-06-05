#!/bin/bash
# Run once, idempotent

# Move bun/bin to #1 without duplicates
export PATH="$(echo "$PATH" | tr ':' '\n' | grep -v "^$HOME/.bun/bin$" | tr '\n' ':')"
export PATH="$HOME/.bun/bin:$PATH"

# Verify
bun -e 'console.log(Bun.which("bun"))'  # Should print ~/.bun/bin/bun
