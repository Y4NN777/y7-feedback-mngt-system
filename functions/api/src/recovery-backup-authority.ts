const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
type ApplicationEnvironment = "preview" | "production";

export function assertRecoveryBackupAuthority(input: {
  readonly sourceEnvironment: string;
  readonly backendEnvironment: string;
  readonly projectId: string;
  readonly previewProjectId?: string | undefined;
}): {
  readonly environment: ApplicationEnvironment;
  readonly projectId: string;
} {
  if (
    (input.sourceEnvironment !== "preview" &&
      input.sourceEnvironment !== "production") ||
    input.backendEnvironment !== input.sourceEnvironment ||
    !appwriteId.test(input.projectId)
  ) {
    throw new Error("RECOVERY_ENVIRONMENT_AUTHORITY_INVALID");
  }
  if (
    input.sourceEnvironment === "production" &&
    (!input.previewProjectId ||
      !appwriteId.test(input.previewProjectId) ||
      input.previewProjectId === input.projectId)
  ) {
    throw new Error("RECOVERY_ENVIRONMENT_COLLISION");
  }
  return { environment: input.sourceEnvironment, projectId: input.projectId };
}
