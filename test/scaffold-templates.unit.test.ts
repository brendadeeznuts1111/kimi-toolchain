import { describe, expect, test } from "bun:test";
import {
  OXFMTRC,
  CI_WORKFLOW,
  TSCONFIG,
  BUNFIG,
  GITIGNORE,
  ENV_EXAMPLE,
  TEMPLATE_MARKERS,
} from "../src/lib/scaffold-templates.ts";

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
});
