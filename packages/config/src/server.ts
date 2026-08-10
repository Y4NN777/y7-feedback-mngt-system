import {
  assertMatchingEnvironment,
  ConfigError,
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
  readonly appwriteSchema: {
    readonly databaseId: string;
    readonly projectsTableId: string;
    readonly reportersTableId: string;
    readonly feedbackTableId: string;
    readonly lifecycleTableId: string;
    readonly accessGrantsTableId: string;
    readonly notificationsTableId: string;
    readonly outboxTableId: string;
    readonly idempotencyTableId: string;
  };
  readonly accessProofEnvelopeKey: string;
  readonly release: string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const proofKey = /^[A-Za-z0-9_-]{43}$/u;

function requireAppwriteId(value: string | undefined): string {
  const id = requireValue(value);
  if (!appwriteId.test(id)) throw new ConfigError("APPWRITE_SCHEMA_INVALID");
  return id;
}

function parseAppwriteSchema(input: Readonly<Record<string, string | undefined>>) {
  const databaseId = requireAppwriteId(input.APPWRITE_DATABASE_ID);
  const tableIds = {
    projectsTableId: requireAppwriteId(input.APPWRITE_PROJECTS_TABLE_ID),
    reportersTableId: requireAppwriteId(input.APPWRITE_REPORTERS_TABLE_ID),
    feedbackTableId: requireAppwriteId(input.APPWRITE_FEEDBACK_TABLE_ID),
    lifecycleTableId: requireAppwriteId(input.APPWRITE_LIFECYCLE_TABLE_ID),
    accessGrantsTableId: requireAppwriteId(input.APPWRITE_ACCESS_GRANTS_TABLE_ID),
    notificationsTableId: requireAppwriteId(input.APPWRITE_NOTIFICATIONS_TABLE_ID),
    outboxTableId: requireAppwriteId(input.APPWRITE_OUTBOX_TABLE_ID),
    idempotencyTableId: requireAppwriteId(input.APPWRITE_IDEMPOTENCY_TABLE_ID),
  };
  if (new Set(Object.values(tableIds)).size !== Object.values(tableIds).length) {
    throw new ConfigError("APPWRITE_SCHEMA_INVALID");
  }
  return { databaseId, ...tableIds };
}

function parseProofKey(value: string | undefined): string {
  const key = requireValue(value);
  if (!proofKey.test(key)) throw new ConfigError("PROOF_KEY_INVALID");
  return key;
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
    appwriteSchema: parseAppwriteSchema(input),
    accessProofEnvelopeKey: parseProofKey(input.ACCESS_PROOF_ENVELOPE_KEY),
    release: requireValue(input.RELEASE),
  };
}
