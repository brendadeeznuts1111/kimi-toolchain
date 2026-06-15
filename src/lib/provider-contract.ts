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

export interface ProviderIntegrationAudit {
  ok: boolean;
  artifacts: string[];
  issues: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasEntries(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function hasNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function createCredentialAdapter(provider: string, secretScope: string): CredentialAdapter {
  return {
    provider,
    secretScope,
    async getToken(getSecret) {
      return { value: await getSecret(secretScope) };
    },
  };
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

export function auditProviderIntegration(
  integration: ProviderIntegration
): ProviderIntegrationAudit {
  const artifacts = providerIntegrationArtifacts(integration);
  const issues: string[] = [];
  const { contract, credentialAdapter } = integration;

  if (artifacts.length !== 2) {
    issues.push("integration must contain exactly contract and credential-adapter artifacts");
  }
  if (!isNonEmptyString(contract?.provider)) issues.push("contract.provider is required");
  if (!isNonEmptyString(contract?.service)) issues.push("contract.service is required");
  if (!hasEntries(contract?.shape)) issues.push("contract.shape must declare at least one field");
  if (!hasNonEmptyStrings(contract?.permissions)) {
    issues.push("contract.permissions must contain at least one permission");
  }
  if (!hasNonEmptyStrings(contract?.errorCategories)) {
    issues.push("contract.errorCategories must contain at least one category");
  }
  if (!isNonEmptyString(credentialAdapter?.provider)) {
    issues.push("credentialAdapter.provider is required");
  }
  if (!isNonEmptyString(credentialAdapter?.secretScope)) {
    issues.push("credentialAdapter.secretScope is required");
  }
  if (typeof credentialAdapter?.getToken !== "function") {
    issues.push("credentialAdapter.getToken is required");
  }
  if (
    isNonEmptyString(contract?.provider) &&
    isNonEmptyString(credentialAdapter?.provider) &&
    contract.provider !== credentialAdapter.provider
  ) {
    issues.push(
      `Provider mismatch: contract=${contract.provider} adapter=${credentialAdapter.provider}`
    );
  }

  return { ok: issues.length === 0, artifacts, issues };
}

export function isTwoArtifactProviderIntegration(integration: ProviderIntegration): boolean {
  return auditProviderIntegration(integration).ok;
}
