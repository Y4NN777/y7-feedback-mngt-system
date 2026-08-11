import type { RepositoryIdentity, SourceProvider } from "@y7-feedback/domain";

export interface ProviderGrantMaterial {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
}

export interface ProviderGrantVault {
  seal(provider: SourceProvider, material: ProviderGrantMaterial): Promise<string>;
  open(
    provider: SourceProvider,
    encryptedGrantRef: string,
  ): Promise<ProviderGrantMaterial>;
  remove(provider: SourceProvider, encryptedGrantRef: string): Promise<void>;
}

export interface SourceProviderAdapter {
  readonly provider: SourceProvider;
  authorizationUrl(input: {
    readonly state: string;
    readonly redirectUri: string;
  }): string;
  completeAuthorization(input: {
    readonly code: string;
    readonly redirectUri: string;
  }): Promise<{
    readonly encryptedGrantRef: string;
    readonly authorizedRepositories: readonly RepositoryIdentity[];
  }>;
  revokeGrant(encryptedGrantRef: string): Promise<void>;
}
