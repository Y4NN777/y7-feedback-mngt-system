export type ApplicationEnvironment = "development" | "preview" | "production";

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ConfigError";
    this.code = code;
  }
}

export function requireValue(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ConfigError("CONFIG_MISSING");
  }
  return value.trim();
}

export function parseEnvironment(value: string | undefined): ApplicationEnvironment {
  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }
  throw new ConfigError("CONFIG_MISSING");
}

export function parseEndpoint(
  value: string | undefined,
  environment: ApplicationEnvironment,
): string {
  const endpoint = requireValue(value);
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new ConfigError("ENDPOINT_INVALID");
  }

  const isLocalDevelopment =
    environment === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new ConfigError("ENDPOINT_INSECURE");
  }

  return endpoint;
}

export function assertMatchingEnvironment(
  environment: ApplicationEnvironment,
  backendEnvironment: ApplicationEnvironment,
): void {
  if (environment !== backendEnvironment) {
    throw new ConfigError("ENVIRONMENT_MISMATCH");
  }
}
