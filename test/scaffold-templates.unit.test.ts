import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  OXFMTRC,
  CI_WORKFLOW,
  TSCONFIG,
  BUNFIG,
  GITIGNORE,
  ENV_EXAMPLE,
  TEMPLATE_MARKERS,
  ADR_TEMPLATE,
  generateReadme,
  generateContext,
  generateLicense,
  scaffoldAdr,
} from "../src/lib/scaffold-templates.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("scaffold-templates", () => {
  test("TEMPLATE_MARKERS match exported template strings", () => {
    const templates: Record<string, string> = {
      OXFMTRC,
      CI_WORKFLOW,
      TSCONFIG,
      BUNFIG,
      GITIGNORE,
      ENV_EXAMPLE,
    };

    for (const [name, markers] of Object.entries(TEMPLATE_MARKERS)) {
      const content = templates[name];
      expect(content).toBeDefined();
      for (const marker of markers) {
        expect(content).toContain(marker);
      }
    }
  });

  describe("ADR_TEMPLATE", () => {
    test("contains required markers", () => {
      expect(ADR_TEMPLATE).toContain("{{DATE}}");
      expect(ADR_TEMPLATE).toContain("{{DECIDERS}}");
      expect(ADR_TEMPLATE).toContain("{{TITLE}}");
      expect(ADR_TEMPLATE).toContain("## Context");
      expect(ADR_TEMPLATE).toContain("## Decision");
      expect(ADR_TEMPLATE).toContain("## Consequences");
      expect(ADR_TEMPLATE).toContain("### Positive");
      expect(ADR_TEMPLATE).toContain("### Negative");
      expect(ADR_TEMPLATE).toContain("### Neutral");
      expect(ADR_TEMPLATE).toContain("## Alternatives Considered");
      expect(ADR_TEMPLATE).toContain("## References");
    });
  });

  describe("generateReadme", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = artifactPath(REPO_ROOT, "tmp", `generateReadme-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns correct content with project name", async () => {
      const mockGetProjectName = async (_dir: string) => "my-awesome-project";
      const filepath = await generateReadme(tmpDir, mockGetProjectName);

      expect(filepath).toBe(join(tmpDir, "README.md"));
      expect(existsSync(filepath)).toBe(true);

      const content = await Bun.file(filepath).text();
      expect(content).toContain("# my-awesome-project");
      expect(content).toContain("## Getting Started");
      expect(content).toContain("bun install");
      expect(content).toContain("bun run dev");
      expect(content).toContain("## Scripts");
    });

    test("uses different project names correctly", async () => {
      const mockGetProjectName = async (_dir: string) => "another-project";
      const filepath = await generateReadme(tmpDir, mockGetProjectName);
      const content = await Bun.file(filepath).text();
      expect(content).toContain("# another-project");
    });
  });

  describe("generateContext", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = artifactPath(REPO_ROOT, "tmp", `generateContext-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns correct content with project name", async () => {
      const mockGetProjectName = async (_dir: string) => "my-awesome-project";
      const filepath = await generateContext(tmpDir, mockGetProjectName);

      expect(filepath).toBe(join(tmpDir, "CONTEXT.md"));
      expect(existsSync(filepath)).toBe(true);

      const content = await Bun.file(filepath).text();
      expect(content).toContain("# CONTEXT - my-awesome-project");
      expect(content).toContain("## Domain");
      expect(content).toContain("## Commands");
      expect(content).toContain("CODE_REFERENCES.md");
    });
  });

  describe("generateLicense", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = artifactPath(REPO_ROOT, "tmp", `generateLicense-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns correct MIT content", async () => {
      const filepath = await generateLicense(tmpDir, "MIT");
      const content = await Bun.file(filepath).text();
      const year = new Date().getFullYear();

      expect(filepath).toBe(join(tmpDir, "LICENSE"));
      expect(content).toContain("MIT License");
      expect(content).toContain(`Copyright (c) ${year}`);
      expect(content).toContain("Permission is hereby granted...");
    });

    test("returns correct generic content for Apache-2.0", async () => {
      const filepath = await generateLicense(tmpDir, "Apache-2.0");
      const content = await Bun.file(filepath).text();
      const year = new Date().getFullYear();

      expect(content).toContain("Apache-2.0 License");
      expect(content).toContain(`Copyright (c) ${year}`);
      expect(content).not.toContain("Permission is hereby granted...");
    });

    test("returns correct generic content for GPL", async () => {
      const filepath = await generateLicense(tmpDir, "GPL");
      const content = await Bun.file(filepath).text();
      const year = new Date().getFullYear();

      expect(content).toContain("GPL License");
      expect(content).toContain(`Copyright (c) ${year}`);
    });

    test("handles unknown license type", async () => {
      const filepath = await generateLicense(tmpDir, "Unknown");
      const content = await Bun.file(filepath).text();
      const year = new Date().getFullYear();

      expect(content).toContain("Unknown License");
      expect(content).toContain(`Copyright (c) ${year}`);
    });
  });

  describe("scaffoldAdr", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = artifactPath(REPO_ROOT, "tmp", `scaffoldAdr-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("creates first ADR with correct naming pattern", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });
      const filepath = await scaffoldAdr(tmpDir, "Use SQLite for storage", ensureDir);

      expect(filepath).toBe(join(tmpDir, "docs", "adr", "0001-use-sqlite-for-storage.md"));
      expect(existsSync(filepath)).toBe(true);

      const content = await Bun.file(filepath).text();
      expect(content).toContain("# Use SQLite for storage");
      expect(content).toContain("@team");
      expect(content).toContain("## Context");
      expect(content).toContain("## Decision");
      expect(content).toContain("## Consequences");
    });

    test("auto-increments ADR number", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });
      const adrDir = join(tmpDir, "docs", "adr");
      mkdirSync(adrDir, { recursive: true });
      writeFileSync(join(adrDir, "0001-first-adr.md"), "# First ADR\n");
      writeFileSync(join(adrDir, "0003-third-adr.md"), "# Third ADR\n");

      const filepath = await scaffoldAdr(tmpDir, "Fourth decision", ensureDir);
      expect(filepath).toBe(join(adrDir, "0004-fourth-decision.md"));
    });

    test("handles titles with special characters in slug", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });
      const filepath = await scaffoldAdr(tmpDir, "API v2.0: GraphQL vs REST?!", ensureDir);

      const filename = filepath.split("/").pop();
      expect(filename).toBe("0001-api-v2-0-graphql-vs-rest.md");
    });

    test("handles titles with leading and trailing special characters", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });
      const filepath = await scaffoldAdr(tmpDir, "!!!Important decision!!!", ensureDir);

      const filename = filepath.split("/").pop();
      expect(filename).toBe("0001-important-decision.md");
    });

    test("replaces template placeholders correctly", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });
      const filepath = await scaffoldAdr(tmpDir, "Migrate to Bun", ensureDir);
      const content = await Bun.file(filepath).text();

      expect(content).toContain("# Migrate to Bun");
      expect(content).toContain("@team");
      expect(content).not.toContain("{{TITLE}}");
      expect(content).not.toContain("{{DECIDERS}}");
      expect(content).not.toContain("{{DATE}}");

      const today = new Date().toISOString().split("T")[0];
      expect(content).toContain(today);
    });

    test("handles multiple ADRs sequentially", async () => {
      const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });

      const filepath1 = await scaffoldAdr(tmpDir, "First decision", ensureDir);
      const filepath2 = await scaffoldAdr(tmpDir, "Second decision", ensureDir);
      const filepath3 = await scaffoldAdr(tmpDir, "Third decision", ensureDir);

      expect(filepath1).toContain("0001-first-decision.md");
      expect(filepath2).toContain("0002-second-decision.md");
      expect(filepath3).toContain("0003-third-decision.md");
    });
  });
});
