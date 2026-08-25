export type FunctionEnvironment = Readonly<Record<string, string | undefined>>;

const endpointKey = "APPWRITE_FUNCTION_API_ENDPOINT";
const projectKey = "APPWRITE_FUNCTION_PROJECT_ID";

function normalized(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const result = value.trim();
  return result.length === 0 ? undefined : result;
}

function executionKeys(
  headers: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === "x-appwrite-key")
    .map(([, value]) => normalized(value))
    .filter((value): value is string => value !== undefined);
}

function conflicts(configured: string | undefined, authoritative: string): boolean {
  const current = normalized(configured);
  return current !== undefined && current !== authoritative;
}

export function resolveAppwriteFunctionEnvironment(
  environment: FunctionEnvironment,
  headers: Readonly<Record<string, string | undefined>>,
): FunctionEnvironment {
  const endpoint = normalized(environment[endpointKey]);
  const projectId = normalized(environment[projectKey]);
  const keys = executionKeys(headers);
  const isFunctionExecution =
    environment[endpointKey] !== undefined ||
    environment[projectKey] !== undefined ||
    Object.keys(headers).some((key) => key.toLowerCase() === "x-appwrite-key");

  if (!isFunctionExecution) return environment;
  if (endpoint === undefined || projectId === undefined || keys.length !== 1) {
    throw new Error("APPWRITE_FUNCTION_RUNTIME_INVALID");
  }
  const [apiKey] = keys;
  if (
    apiKey === undefined ||
    conflicts(environment.APPWRITE_ENDPOINT, endpoint) ||
    conflicts(environment.APPWRITE_PROJECT_ID, projectId) ||
    conflicts(environment.APPWRITE_API_KEY, apiKey)
  ) {
    throw new Error("APPWRITE_FUNCTION_RUNTIME_MISMATCH");
  }
  return {
    ...environment,
    APPWRITE_ENDPOINT: endpoint,
    APPWRITE_PROJECT_ID: projectId,
    APPWRITE_API_KEY: apiKey,
  };
}
