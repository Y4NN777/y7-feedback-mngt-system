type ApplicationEnvironment = "development" | "preview" | "production";

export interface AppwriteProvisioningMode {
  readonly seedFixtures: boolean;
}

export function resolveAppwriteProvisioningMode(
  environment: ApplicationEnvironment,
  productionAuthorized: boolean,
): AppwriteProvisioningMode {
  if (environment === "preview") return { seedFixtures: true };
  if (environment === "production") {
    if (!productionAuthorized) {
      throw new Error("APPWRITE_PROVISION_PRODUCTION_AUTHORIZATION_REQUIRED");
    }
    return { seedFixtures: false };
  }
  throw new Error("APPWRITE_PROVISION_ENVIRONMENT_INVALID");
}
