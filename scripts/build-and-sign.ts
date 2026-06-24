#!/usr/bin/env bun
/**
 * build-and-sign.ts
 *
 * Local release builder – reads the canonical Bun version from the registry,
 * builds Bun from source, signs the binary, and verifies the signature.
 *
 * Usage:
 *   bun run scripts/build-and-sign.ts
 *
 * Prerequisites:
 *   - Bun installed (>= 1.3.6)
 *   - Signing key via Bun.secrets (com.herdr.release/bun-release-signing-key) or
 *     BUN_RELEASE_SIGNING_KEY env var (env-fallback alias)
 *   - Git available (for cloning Bun)
 *   - A signing tool (example uses minisign, adjust to your actual tool)
 */

import { $ } from "bun";
import { existsSync, rmSync } from "node:fs";
import { BUN_RELEASE } from "../src/lib/bun-utils.ts";

// ---------------------------------------------------------------------------
// 1. Canonical version from the registry
// ---------------------------------------------------------------------------
const VERSION = BUN_RELEASE.version;
console.log(`📦 Building Bun ${VERSION} (tag: ${BUN_RELEASE.tag})`);

// ---------------------------------------------------------------------------
// 2. Prepare Bun source (clone if not already present)
// ---------------------------------------------------------------------------
const BUN_SRC_DIR = "./.bun-build/bun-src";
if (!existsSync(BUN_SRC_DIR)) {
  console.log("📥 Cloning Bun repository (shallow)...");
  await $`git clone --depth 1 --branch ${BUN_RELEASE.tag} https://github.com/oven-sh/bun.git ${BUN_SRC_DIR}`;
} else {
  console.log("📁 Using existing Bun source directory");
  await $`git -C ${BUN_SRC_DIR} fetch --tags --depth 1`;
  await $`git -C ${BUN_SRC_DIR} checkout ${BUN_RELEASE.tag}`;
}

// ---------------------------------------------------------------------------
// 3. Build Bun (adjust command to your build setup)
// ---------------------------------------------------------------------------
console.log("🔨 Building Bun...");
await $`cd ${BUN_SRC_DIR} && bun run build:release`; // replace with actual build command
// Assuming the output binary is at ${BUN_SRC_DIR}/build/bun
const UNSIGNED_BINARY = `${BUN_SRC_DIR}/build/bun`;
if (!existsSync(UNSIGNED_BINARY)) {
  console.error("❌ Build failed – binary not found.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Sign the binary
// ---------------------------------------------------------------------------
const SIGNING_KEY = process.env.BUN_RELEASE_SIGNING_KEY;
if (!SIGNING_KEY) {
  console.error(
    "❌ BUN_RELEASE_SIGNING_KEY not set. Set the environment variable or provide a key file."
  );
  process.exit(1);
}

// Example: minisign signing. Replace with your actual signing tool.
const SIGNED_BINARY = "./bun-signed";
console.log("✍️  Signing binary...");
// Write key to a temporary file, sign, then immediately remove it
const keyFile = "./.signing-key-tmp";
await Bun.write(keyFile, SIGNING_KEY);
try {
  // Adjust the command: -s = sign, -m = output file, -S = secret key file
  await $`minisign -S -s ${keyFile} -m ${UNSIGNED_BINARY} -x ${SIGNED_BINARY}`;
} finally {
  rmSync(keyFile); // secret never touches disk after this
}

// ---------------------------------------------------------------------------
// 5. Verify the signature (smoke test)
// ---------------------------------------------------------------------------
console.log("🔍 Verifying signature...");
await $`minisign -V -x ${SIGNED_BINARY} -p ./public/minisign.pub`; // public key must exist
console.log("✅ Signature verified.");

// ---------------------------------------------------------------------------
// 6. Output the final artifact
// ---------------------------------------------------------------------------
console.log(`\n🎉 Signed Bun ${VERSION} binary ready: ${SIGNED_BINARY}`);
