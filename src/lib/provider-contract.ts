/**
 * Provider integration contract.
 *
 * New providers should be represented by exactly two artifacts:
 * a contract declaration and a thin credential adapter.
 */

export type GetSecret = (scope: string) => string | Promise<string>;

export interface ContractDeclaration {
  provider: string;
  service: string;
  shape: Record<string, unknown>;
  permissions: string[];
  errorCategories: string[];
}

export interface ShortLivedToken {
  value: string;
  expiresAt?: string;
}

export interface CredentialAdapter {
  provider: string;
  secretScope: string;
  getToken(getSecret: GetSecret): Promise<ShortLivedToken>;
}

export interface ProviderIntegration {
  contract: ContractDeclaration;
  credentialAdapter: CredentialAdapter;
}

export function defineProviderIntegration(
  contract: ContractDeclaration,
  credentialAdapter: CredentialAdapter
): ProviderIntegration {
  if (contract.provider !== credentialAdapter.provider) {
    throw new Error(
      `Provider mismatch: contract=${contract.provider} adapter=${credentialAdapter.provider}`
    );
  }
  return { contract, credentialAdapter };
}

export function providerIntegrationArtifacts(integration: ProviderIntegration): string[] {
  const artifacts: string[] = [];
  if (integration.contract) artifacts.push("contract");
  if (integration.credentialAdapter) artifacts.push("credential-adapter");
  return artifacts;
}

export function isTwoArtifactProviderIntegration(integration: ProviderIntegration): boolean {
  return providerIntegrationArtifacts(integration).length === 2;
}
