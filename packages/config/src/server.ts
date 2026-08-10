import {
  assertMatchingEnvironment,
  parseEndpoint,
  parseEnvironment,
  requireValue,
  type ApplicationEnvironment,
} from "./shared";

export interface ServerConfig {
  readonly environment: ApplicationEnvironment;
  readonly backendEnvironment: ApplicationEnvironment;
  readonly appwriteEndpoint: string;
  readonly appwriteProjectId: string;
  readonly appwriteApiKey: string;
  readonly release: string;
}

export function parseServerConfig(
  input: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const environment = parseEnvironment(input.Y7_ENVIRONMENT);
  const backendEnvironment = parseEnvironment(input.APPWRITE_ENVIRONMENT);
  assertMatchingEnvironment(environment, backendEnvironment);

  return {
    environment,
    backendEnvironment,
    appwriteEndpoint: parseEndpoint(input.APPWRITE_ENDPOINT, environment),
    appwriteProjectId: requireValue(input.APPWRITE_PROJECT_ID),
    appwriteApiKey: requireValue(input.APPWRITE_API_KEY),
    release: requireValue(input.RELEASE),
  };
}
