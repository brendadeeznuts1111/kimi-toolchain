import { describe, expect, test } from "bun:test";
import { tlsComplianceGate } from "../../src/guardian/tls-compliance.ts";

describe("tls-compliance", () => {
  test("returns a result object with status", async () => {
    const result = await tlsComplianceGate({
      floor: "TLSv1.2",
      endpoints: { tls11: "https://localhost:1/", tls10: "https://localhost:1/" },
    });
    expect(result).toHaveProperty("status");
    expect(["pass", "fail"]).toContain(result.status);
  });

  test("passes when both legacy endpoints reject", async () => {
    const result = await tlsComplianceGate({
      floor: "TLSv1.2",
      endpoints: { tls11: "https://localhost:1/", tls10: "https://localhost:1/" },
    });
    expect(result.status).toBe("pass");
  });
});
