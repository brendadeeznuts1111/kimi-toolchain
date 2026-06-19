import { describe, expect, test } from "bun:test";
import {
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
      {
        provider: "cloudflare",
        secretScope: "cloudflare-access",
        async getToken(getSecret) {
          return { value: await getSecret("cloudflare-access") };
        },
      }
    );

    expect(providerIntegrationArtifacts(integration)).toEqual(["contract", "credential-adapter"]);
    expect(isTwoArtifactProviderIntegration(integration)).toBe(true);
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
});
