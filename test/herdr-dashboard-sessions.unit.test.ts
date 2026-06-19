import { describe, expect, test } from "bun:test";
import {
  buildSingleSessionCatalog,
  discoverLocalSessionsCatalog,
  finalizeSessionCatalog,
} from "../src/lib/herdr-dashboard-sessions.ts";

describe("herdr-dashboard-sessions", () => {
  test("buildSingleSessionCatalog uses primary for empty session", () => {
    const catalog = buildSingleSessionCatalog("");
    expect(catalog.sessionsAvailable).toEqual([""]);
    expect(catalog.entries[0]?.label).toBe("primary");
    expect(catalog.entries[0]?.reachable).toBe(true);
  });

  test("finalizeSessionCatalog dedupes session ids with primary first", () => {
    const catalog = finalizeSessionCatalog([
      { session: "staging", label: "staging", host: "(local)", reachable: true },
      { session: "", label: "primary", host: "(local)", reachable: true },
      {
        session: "staging",
        label: "staging",
        host: "workbox",
        reachable: false,
        error: "not running",
      },
    ]);
    expect(catalog.sessionsAvailable).toEqual(["", "staging"]);
    expect(catalog.entries).toHaveLength(3);
  });

  test("discoverLocalSessionsCatalog always includes primary", () => {
    const catalog = discoverLocalSessionsCatalog();
    expect(catalog.sessionsAvailable[0]).toBe("");
    expect(catalog.entries.some((row) => row.session === "" && row.label === "primary")).toBe(true);
  });

  test("finalizeSessionCatalog orders primary before named sessions", () => {
    const catalog = finalizeSessionCatalog([
      { session: "beta", label: "beta", host: "(local)", reachable: true },
      { session: "", label: "primary", host: "(local)", reachable: true },
      { session: "alpha", label: "alpha", host: "(local)", reachable: true },
    ]);
    expect(catalog.sessionsAvailable).toEqual(["", "alpha", "beta"]);
  });
});
