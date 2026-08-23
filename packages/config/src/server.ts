import {
  assertMatchingEnvironment,
  ConfigError,
  parseEndpoint,
  parseEnvironment,
  requireValue,
  type ApplicationEnvironment,
} from "./shared.js";

export interface ServerConfig {
  readonly environment: ApplicationEnvironment;
  readonly backendEnvironment: ApplicationEnvironment;
  readonly appwriteEndpoint: string;
  readonly appwriteProjectId: string;
  readonly appwriteApiKey: string;
  readonly appwriteSchema: {
    readonly databaseId: string;
    readonly workspacesTableId: string;
    readonly workspaceMembershipsTableId: string;
    readonly projectAssignmentsTableId: string;
    readonly projectSlugsTableId: string;
    readonly projectsTableId: string;
    readonly reportersTableId: string;
    readonly feedbackTableId: string;
    readonly lifecycleTableId: string;
    readonly accessGrantsTableId: string;
    readonly notificationsTableId: string;
    readonly outboxTableId: string;
    readonly idempotencyTableId: string;
    readonly attachmentBucketId: string;
    readonly attachmentStagingTableId: string;
    readonly attachmentsTableId: string;
    readonly providerGrantsTableId: string;
    readonly sourceConnectionsTableId: string;
  };
  readonly accessProofEnvelopeKey: string;
  readonly providerGrantEnvelopeKey: string;
  readonly sensitiveDataActiveKeyId: string;
  readonly sensitiveDataEnvelopeKeys: Readonly<Record<string, string>>;
  readonly release: string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const proofKey = /^[A-Za-z0-9_-]{43}$/u;
const keyId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

function requireAppwriteId(value: string | undefined): string {
  const id = requireValue(value);
  if (!appwriteId.test(id)) throw new ConfigError("APPWRITE_SCHEMA_INVALID");
  return id;
}

function parseAppwriteSchema(input: Readonly<Record<string, string | undefined>>) {
  const databaseId = requireAppwriteId(input.APPWRITE_DATABASE_ID);
  const tableIds = {
    workspacesTableId: requireAppwriteId(input.APPWRITE_WORKSPACES_TABLE_ID),
    workspaceMembershipsTableId: requireAppwriteId(
      input.APPWRITE_WORKSPACE_MEMBERSHIPS_TABLE_ID,
    ),
    projectAssignmentsTableId: requireAppwriteId(
      input.APPWRITE_PROJECT_ASSIGNMENTS_TABLE_ID,
    ),
    projectSlugsTableId: requireAppwriteId(input.APPWRITE_PROJECT_SLUGS_TABLE_ID),
    projectsTableId: requireAppwriteId(input.APPWRITE_PROJECTS_TABLE_ID),
    reportersTableId: requireAppwriteId(input.APPWRITE_REPORTERS_TABLE_ID),
    feedbackTableId: requireAppwriteId(input.APPWRITE_FEEDBACK_TABLE_ID),
    lifecycleTableId: requireAppwriteId(input.APPWRITE_LIFECYCLE_TABLE_ID),
    accessGrantsTableId: requireAppwriteId(input.APPWRITE_ACCESS_GRANTS_TABLE_ID),
    notificationsTableId: requireAppwriteId(input.APPWRITE_NOTIFICATIONS_TABLE_ID),
    outboxTableId: requireAppwriteId(input.APPWRITE_OUTBOX_TABLE_ID),
    idempotencyTableId: requireAppwriteId(input.APPWRITE_IDEMPOTENCY_TABLE_ID),
    attachmentBucketId: requireAppwriteId(input.APPWRITE_ATTACHMENT_BUCKET_ID),
    attachmentStagingTableId: requireAppwriteId(
      input.APPWRITE_ATTACHMENT_STAGING_TABLE_ID,
    ),
    attachmentsTableId: requireAppwriteId(input.APPWRITE_ATTACHMENTS_TABLE_ID),
    providerGrantsTableId: requireAppwriteId(input.APPWRITE_PROVIDER_GRANTS_TABLE_ID),
    sourceConnectionsTableId: requireAppwriteId(
      input.APPWRITE_SOURCE_CONNECTIONS_TABLE_ID,
    ),
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

function parseProviderGrantKey(
  value: string | undefined,
  proofEnvelopeKey: string,
): string {
  const key = requireValue(value);
  if (!proofKey.test(key) || key === proofEnvelopeKey) {
    throw new ConfigError("PROVIDER_GRANT_KEY_INVALID");
  }
  return key;
}

function parseSensitiveDataKeys(
  value: string | undefined,
  activeKeyIdValue: string | undefined,
  prohibitedKeys: readonly string[],
): {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, string>>;
} {
  const activeKeyId = requireValue(activeKeyIdValue);
  if (!keyId.test(activeKeyId)) throw new ConfigError("SENSITIVE_DATA_KEYS_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(requireValue(value)) as unknown;
  } catch {
    throw new ConfigError("SENSITIVE_DATA_KEYS_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError("SENSITIVE_DATA_KEYS_INVALID");
  }
  const entries = Object.entries(parsed as Readonly<Record<string, unknown>>);
  const materials = new Set<string>();
  if (
    entries.length === 0 ||
    entries.some(([id, material]) => {
      if (
        !keyId.test(id) ||
        typeof material !== "string" ||
        !proofKey.test(material) ||
        materials.has(material) ||
        prohibitedKeys.includes(material)
      ) {
        return true;
      }
      materials.add(material);
      return false;
    }) ||
    !Object.hasOwn(parsed, activeKeyId)
  ) {
    throw new ConfigError("SENSITIVE_DATA_KEYS_INVALID");
  }
  return {
    activeKeyId,
    keys: Object.fromEntries(entries) as Readonly<Record<string, string>>,
  };
}

export function parseServerConfig(
  input: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const environment = parseEnvironment(input.Y7_ENVIRONMENT);
  const backendEnvironment = parseEnvironment(input.APPWRITE_ENVIRONMENT);
  assertMatchingEnvironment(environment, backendEnvironment);

  const accessProofEnvelopeKey = parseProofKey(input.ACCESS_PROOF_ENVELOPE_KEY);
  const providerGrantEnvelopeKey = parseProviderGrantKey(
    input.PROVIDER_GRANT_ENVELOPE_KEY,
    accessProofEnvelopeKey,
  );
  const sensitiveDataKeys = parseSensitiveDataKeys(
    input.SENSITIVE_DATA_ENVELOPE_KEYS,
    input.SENSITIVE_DATA_ACTIVE_KEY_ID,
    [accessProofEnvelopeKey, providerGrantEnvelopeKey],
  );
  return {
    environment,
    backendEnvironment,
    appwriteEndpoint: parseEndpoint(input.APPWRITE_ENDPOINT, environment),
    appwriteProjectId: requireValue(input.APPWRITE_PROJECT_ID),
    appwriteApiKey: requireValue(input.APPWRITE_API_KEY),
    appwriteSchema: parseAppwriteSchema(input),
    accessProofEnvelopeKey,
    providerGrantEnvelopeKey,
    sensitiveDataActiveKeyId: sensitiveDataKeys.activeKeyId,
    sensitiveDataEnvelopeKeys: sensitiveDataKeys.keys,
    release: requireValue(input.RELEASE),
  };
}
