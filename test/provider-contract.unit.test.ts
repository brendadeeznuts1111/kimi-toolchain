import { describe, expect, test } from "bun:test";
import {
  auditProviderIntegration,
  createCredentialAdapter,
  defineProviderIntegration,
  isTwoArtifactProviderIntegration,
  providerIntegrationArtifacts,
} from "../src/lib/provider-contract.ts";

describe("provider-contract", () => {
  test("defines provider integration as contract plus credential adapter", async () => {
    const integration = defineProviderIntegration(
      {
        provider: "cloudflare",
        service: "access",
        shape: { apps: "Access application list" },
        permissions: ["Account > Access: Read"],
        errorCategories: ["http_error"],
      },
      createCredentialAdapter("cloudflare", "cloudflare-access")
    );

    expect(providerIntegrationArtifacts(integration)).toEqual(["contract", "credential-adapter"]);
    expect(isTwoArtifactProviderIntegration(integration)).toBe(true);
    expect(auditProviderIntegration(integration).ok).toBe(true);
    await expect(integration.credentialAdapter.getToken(() => "token")).resolves.toEqual({
      value: "token",
    });
  });

  test("rejects mismatched provider contract and credential adapter", () => {
    expect(() =>
      defineProviderIntegration(
        {
          provider: "aws",
          service: "iam",
          shape: {},
          permissions: [],
          errorCategories: [],
        },
        {
          provider: "cloudflare",
          secretScope: "cloudflare-access",
          async getToken() {
            return { value: "token" };
          },
        }
      )
    ).toThrow("Provider mismatch");
  });

  test("audits meaningful provider contract invariants", () => {
    const integration = {
      contract: {
        provider: "cloudflare",
        service: "",
        shape: {},
        permissions: [],
        errorCategories: [],
      },
      credentialAdapter: createCredentialAdapter("cloudflare", ""),
    };

    const audit = auditProviderIntegration(integration);

    expect(audit.ok).toBe(false);
    expect(audit.issues).toContain("contract.service is required");
    expect(audit.issues).toContain("contract.shape must declare at least one field");
    expect(audit.issues).toContain("contract.permissions must contain at least one permission");
    expect(audit.issues).toContain("contract.errorCategories must contain at least one category");
    expect(audit.issues).toContain("credentialAdapter.secretScope is required");
    expect(isTwoArtifactProviderIntegration(integration)).toBe(false);
  });

  test("credential adapter reads only its declared secret scope", async () => {
    const scopes: string[] = [];
    const adapter = createCredentialAdapter("aws", "aws-iam");

    const token = await adapter.getToken((scope) => {
      scopes.push(scope);
      return `token:${scope}`;
    });

    expect(scopes).toEqual(["aws-iam"]);
    expect(token).toEqual({ value: "token:aws-iam" });
  });
});
