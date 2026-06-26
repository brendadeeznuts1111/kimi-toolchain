#!/usr/bin/env bun
/**
 * validate-taxonomy.ts
 *
 * CLI wrapper around src/completions/taxonomy-validator.ts.
 * Exits 1 if any flag is categorized into more than one bucket.
 */

import { validateTaxonomy } from "../src/completions/taxonomy-validator.ts";

const sourcePath = import.meta.dir.endsWith("scripts")
  ? `${import.meta.dir}/../src/completions/flag-taxonomy.ts`
  : `${import.meta.dir}/src/completions/flag-taxonomy.ts`;

const result = await validateTaxonomy(sourcePath);
console.log(result.valid ? "✅" : "❌", result.message);
process.exit(result.valid ? 0 : 1);
