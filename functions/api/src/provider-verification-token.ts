export function resolveProviderVerificationToken(input: {
  readonly provider: "github" | "gitlab";
  readonly configuredToken?: string | undefined;
  readonly authorizedGrantToken?: string | undefined;
  readonly cliToken?: (() => string) | undefined;
}): string {
  const configured = input.configuredToken?.trim();
  if (configured) return configured;
  const authorizedGrant = input.authorizedGrantToken?.trim();
  if (authorizedGrant) return authorizedGrant;
  const cli = input.cliToken?.().trim();
  if (cli) return cli;
  throw new Error(
    input.provider === "github"
      ? "MESSAGE_SYNC_GITHUB_CREDENTIAL_REQUIRED"
      : "MESSAGE_SYNC_GITLAB_CREDENTIAL_REQUIRED",
  );
}
