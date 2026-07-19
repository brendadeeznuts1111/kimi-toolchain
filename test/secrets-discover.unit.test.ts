import { describe, expect, test } from "bun:test";
import {
  buildDiscoverReport,
  namespaceOf,
  parseKeychainDump,
} from "../src/lib/secrets-discover.ts";

const DUMP_FIXTURE = `keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "svce"<blob>="kimi-toolchain"
    "acct"<blob>="cloudflare-api-token"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "svce"<blob>="kimi-toolchain"
    "acct"<blob>="cloudflare-account-id"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "svce"<blob>="com.cloudflare.r2.rssfeedmaster"
    "acct"<blob>="item-1"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "svce"<blob>="com.cloudflare.r2.rssfeedmaster"
    "acct"<blob>="item-2"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
    "svce"<blob>="factory-wager"
    "acct"<blob>="api-key"
`;

const POLICY_ENTRIES = [
  {
    service: "kimi-toolchain",
    name: "cloudflare-api-token",
    entry: {
      allowedConsumers: ["kimi-doctor"],
      rotationDays: 90,
      lastRotated: "2026-07-01",
      version: 1,
    },
  },
  {
    service: "kimi-toolchain",
    name: "cloudflare-account-id",
    entry: { allowedConsumers: ["kimi-doctor"], rotationDays: 365, lastRotated: null, version: 1 },
  },
  {
    service: "com.herdr.cli",
    name: "github-token",
    entry: { allowedConsumers: ["kimi-doctor"], rotationDays: 90, lastRotated: null, version: 1 },
  },
];

describe("secrets-discover", () => {
  test("parseKeychainDump maps service to account names", () => {
    const dump = parseKeychainDump(DUMP_FIXTURE);
    expect(dump.get("kimi-toolchain")).toEqual(["cloudflare-api-token", "cloudflare-account-id"]);
    expect(dump.get("com.cloudflare.r2.rssfeedmaster")).toEqual(["item-1", "item-2"]);
    expect(dump.get("factory-wager")).toEqual(["api-key"]);
    expect(dump.size).toBe(3);
  });

  test("parseKeychainDump tolerates items without accounts", () => {
    const dump = parseKeychainDump(
      `keychain: "/x"\n    "svce"<blob>="orphan-service"\nkeychain: "/x"\n    "svce"<blob>="other"\n    "acct"<blob>="a"\n`
    );
    expect(dump.get("orphan-service")).toEqual([""]);
    expect(dump.get("other")).toEqual(["a"]);
  });

  test("namespaceOf buckets reverse-domain and plain services", () => {
    expect(namespaceOf("com.cloudflare.r2.rssfeedmaster")).toBe("com.cloudflare");
    expect(namespaceOf("com.factory-wager.cloudflare")).toBe("com.factory-wager");
    expect(namespaceOf("factory-wager")).toBe("factory");
    expect(namespaceOf("windsurf-r2-empire")).toBe("windsurf");
    expect(namespaceOf("r2")).toBe("r2");
  });

  test("buildDiscoverReport builds presence matrix and rotation states", () => {
    const report = buildDiscoverReport(POLICY_ENTRIES, parseKeychainDump(DUMP_FIXTURE), {
      now: new Date("2026-07-18T00:00:00Z"),
    });
    expect(report.registeredPresent).toBe(2);
    expect(report.registeredMissing).toBe(1);

    const kimi = report.registered.find((s) => s.service === "kimi-toolchain")!;
    expect(kimi.present).toBe(2);
    expect(kimi.missing).toBe(0);
    const token = kimi.names.find((n) => n.name === "cloudflare-api-token")!;
    expect(token.rotation).toBe("ok"); // rotated 17 days ago, policy 90 days
    const account = kimi.names.find((n) => n.name === "cloudflare-account-id")!;
    expect(account.rotation).toBe("untracked"); // present but never rotated

    const herdr = report.registered.find((s) => s.service === "com.herdr.cli")!;
    expect(herdr.missing).toBe(1);
    expect(herdr.names[0]!.rotation).toBeNull(); // absent → no rotation info
  });

  test("buildDiscoverReport flags stale rotations", () => {
    const entries = [
      {
        service: "kimi-toolchain",
        name: "cloudflare-api-token",
        entry: {
          allowedConsumers: ["kimi-doctor"],
          rotationDays: 7,
          lastRotated: "2026-06-01",
          version: 1,
        },
      },
    ];
    const report = buildDiscoverReport(entries, parseKeychainDump(DUMP_FIXTURE), {
      now: new Date("2026-07-18T00:00:00Z"),
    });
    expect(report.registered[0]!.names[0]!.rotation).toBe("stale");
  });

  test("buildDiscoverReport reports unregistered sprawl sorted by items", () => {
    const report = buildDiscoverReport(POLICY_ENTRIES, parseKeychainDump(DUMP_FIXTURE));
    expect(report.totalItems).toBe(5);
    expect(report.totalServices).toBe(3);
    expect(report.unregistered).toEqual([
      { namespace: "com.cloudflare", services: ["com.cloudflare.r2.rssfeedmaster"], items: 2 },
      { namespace: "factory", services: ["factory-wager"], items: 1 },
    ]);
  });

  test("buildDiscoverReport marks unsupported backends", () => {
    const report = buildDiscoverReport(POLICY_ENTRIES, new Map(), { unsupported: true });
    expect(report.backend).toBe("unsupported");
    expect(report.registeredMissing).toBe(3);
    expect(report.warnings.length).toBe(1);
  });
});
