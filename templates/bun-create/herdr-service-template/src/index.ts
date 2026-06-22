#!/usr/bin/env bun
import { secrets } from "./lib/secrets/index.ts";

const resolved = await secrets.resolve();
const missing = Object.entries(resolved)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error(`❌ Missing secrets: ${missing.join(", ")}`);
  await secrets.dryRun();
  process.exit(1);
}

console.log(`✅ ${secrets.service} booted with ${Object.keys(resolved).length} secrets`);
