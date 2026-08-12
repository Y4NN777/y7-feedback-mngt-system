import {
  assertMatchingEnvironment,
  ConfigError,
  parseEndpoint,
  parseEnvironment,
  requireValue,
  type ApplicationEnvironment,
} from "./shared.js";

export { ConfigError } from "./shared.js";
export type { ApplicationEnvironment } from "./shared.js";

export interface PublicConfig {
  readonly environment: ApplicationEnvironment;
  readonly backendEnvironment: ApplicationEnvironment;
  readonly appwriteEndpoint: string;
  readonly appwriteProjectId: string;
  readonly apiEndpoint: string;
  readonly release: string;
}

const secretBearingPublicKey =
  /_(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_PROOF|PASSWORD)(?:_|$)/u;

export function parsePublicConfig(
  input: Readonly<Record<string, string | undefined>>,
): PublicConfig {
  if (
    Object.keys(input).some(
      (key) => key.startsWith("VITE_") && secretBearingPublicKey.test(key),
    )
  ) {
    throw new ConfigError("PUBLIC_SECRET_KEY");
  }

  const environment = parseEnvironment(input.VITE_Y7_ENVIRONMENT);
  const backendEnvironment = parseEnvironment(input.VITE_APPWRITE_ENVIRONMENT);
  assertMatchingEnvironment(environment, backendEnvironment);

  return {
    environment,
    backendEnvironment,
    appwriteEndpoint: parseEndpoint(input.VITE_APPWRITE_ENDPOINT, environment),
    appwriteProjectId: requireValue(input.VITE_APPWRITE_PROJECT_ID),
    apiEndpoint: parseEndpoint(input.VITE_API_ENDPOINT, environment),
    release: requireValue(input.VITE_RELEASE),
  };
}

export function assertEnvironmentIsolation(
  first: PublicConfig,
  second: PublicConfig,
): void {
  if (
    first.environment !== second.environment &&
    first.appwriteEndpoint === second.appwriteEndpoint &&
    first.appwriteProjectId === second.appwriteProjectId
  ) {
    throw new ConfigError("ENVIRONMENT_AUTHORITY_SHARED");
  }
}
