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
  readonly webOrigin: string;
  readonly providerOutboxTriggerSecret?: string;
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
    readonly notificationSignalsTableId: string;
    readonly outboxTableId: string;
    readonly idempotencyTableId: string;
    readonly attachmentBucketId: string;
    readonly attachmentStagingTableId: string;
    readonly attachmentsTableId: string;
    readonly providerGrantsTableId: string;
    readonly sourceConnectionsTableId: string;
    readonly administrationAuditTableId: string;
    readonly administrationIdempotencyTableId: string;
    readonly conversationMessagesTableId: string;
    readonly conversationInternalNotesTableId: string;
    readonly conversationIdempotencyTableId: string;
    readonly conversationLifecycleTableId: string;
    readonly publicationConsentsTableId: string;
    readonly externalIssueLinksTableId: string;
    readonly providerOutboxTableId: string;
    readonly providerEventInboxTableId: string;
    readonly providerSyncOutboxTableId: string;
    readonly offlineConflictProjectionsTableId: string;
    readonly intelligenceProvenanceTableId: string;
    readonly deletionRecordsTableId: string;
    readonly abuseCountersTableId: string;
    readonly exceptionalAccessGrantsTableId: string;
    readonly exceptionalAccessAuditTableId: string;
  };
  readonly accessProofEnvelopeKey: string;
  readonly providerGrantEnvelopeKey: string;
  readonly sensitiveDataActiveKeyId: string;
  readonly sensitiveDataEnvelopeKeys: Readonly<Record<string, string>>;
  readonly abuseHmacActiveKeyId: string;
  readonly abuseHmacKeys: Readonly<Record<string, string>>;
  readonly providers?: {
    readonly github: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly callbackUrl: string;
    };
    readonly gitlab: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly callbackUrl: string;
      readonly origin: string;
    };
  };
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
    notificationSignalsTableId: requireAppwriteId(
      input.APPWRITE_NOTIFICATION_SIGNALS_TABLE_ID,
    ),
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
    administrationAuditTableId: requireAppwriteId(
      input.APPWRITE_ADMINISTRATION_AUDIT_TABLE_ID,
    ),
    administrationIdempotencyTableId: requireAppwriteId(
      input.APPWRITE_ADMINISTRATION_IDEMPOTENCY_TABLE_ID,
    ),
    conversationMessagesTableId: requireAppwriteId(
      input.APPWRITE_CONVERSATION_MESSAGES_TABLE_ID,
    ),
    conversationInternalNotesTableId: requireAppwriteId(
      input.APPWRITE_CONVERSATION_INTERNAL_NOTES_TABLE_ID,
    ),
    conversationIdempotencyTableId: requireAppwriteId(
      input.APPWRITE_CONVERSATION_IDEMPOTENCY_TABLE_ID,
    ),
    conversationLifecycleTableId: requireAppwriteId(
      input.APPWRITE_CONVERSATION_LIFECYCLE_TABLE_ID,
    ),
    publicationConsentsTableId: requireAppwriteId(
      input.APPWRITE_PUBLICATION_CONSENTS_TABLE_ID,
    ),
    externalIssueLinksTableId: requireAppwriteId(
      input.APPWRITE_EXTERNAL_ISSUE_LINKS_TABLE_ID,
    ),
    providerOutboxTableId: requireAppwriteId(input.APPWRITE_PROVIDER_OUTBOX_TABLE_ID),
    providerEventInboxTableId: requireAppwriteId(
      input.APPWRITE_PROVIDER_EVENT_INBOX_TABLE_ID ?? "provider_event_inbox",
    ),
    providerSyncOutboxTableId: requireAppwriteId(
      input.APPWRITE_PROVIDER_SYNC_OUTBOX_TABLE_ID ?? "provider_sync_outbox",
    ),
    offlineConflictProjectionsTableId: requireAppwriteId(
      input.APPWRITE_OFFLINE_CONFLICT_PROJECTIONS_TABLE_ID ??
        "offline_conflict_projections",
    ),
    intelligenceProvenanceTableId: requireAppwriteId(
      input.APPWRITE_INTELLIGENCE_PROVENANCE_TABLE_ID ?? "intelligence_provenance",
    ),
    deletionRecordsTableId: requireAppwriteId(
      input.APPWRITE_DELETION_RECORDS_TABLE_ID ?? "deletion_records",
    ),
    abuseCountersTableId: requireAppwriteId(
      input.APPWRITE_ABUSE_COUNTERS_TABLE_ID ?? "abuse_counters",
    ),
    exceptionalAccessGrantsTableId: requireAppwriteId(
      input.APPWRITE_EXCEPTIONAL_ACCESS_GRANTS_TABLE_ID ?? "exceptional_access_grants",
    ),
    exceptionalAccessAuditTableId: requireAppwriteId(
      input.APPWRITE_EXCEPTIONAL_ACCESS_AUDIT_TABLE_ID ?? "exceptional_access_audit",
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

function parseWebOrigin(
  value: string | undefined,
  environment: ApplicationEnvironment,
): string {
  const endpoint = parseEndpoint(value, environment);
  const url = new URL(endpoint);
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ConfigError("WEB_ORIGIN_INVALID");
  }
  return url.origin;
}

function parseOptionalTriggerSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") return undefined;
  if (normalized.length < 32 || normalized.length > 500) {
    throw new ConfigError("PROVIDER_OUTBOX_TRIGGER_SECRET_INVALID");
  }
  return normalized;
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

function parseProviders(
  input: Readonly<Record<string, string | undefined>>,
): ServerConfig["providers"] {
  const keys = [
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_CALLBACK_URL",
    "GITLAB_OAUTH_CLIENT_ID",
    "GITLAB_OAUTH_CLIENT_SECRET",
    "GITLAB_OAUTH_CALLBACK_URL",
    "GITLAB_OAUTH_ORIGIN",
  ] as const;
  const values = keys.map((key) => input[key]?.trim() ?? "");
  if (values.every((value) => value === "")) return undefined;
  if (values.some((value) => value === "")) {
    throw new ConfigError("PROVIDER_CONFIG_INVALID");
  }
  const [
    githubClientId,
    githubClientSecret,
    githubCallback,
    gitlabClientId,
    gitlabClientSecret,
    gitlabCallback,
    gitlabOriginValue,
  ] = values as [string, string, string, string, string, string, string];
  let githubCallbackUrl: URL;
  let gitlabCallbackUrl: URL;
  let gitlabOrigin: URL;
  try {
    githubCallbackUrl = new URL(githubCallback);
    gitlabCallbackUrl = new URL(gitlabCallback);
    gitlabOrigin = new URL(gitlabOriginValue);
  } catch {
    throw new ConfigError("PROVIDER_CONFIG_INVALID");
  }
  const safeCallback = (url: URL) =>
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "";
  if (
    !safeCallback(githubCallbackUrl) ||
    !safeCallback(gitlabCallbackUrl) ||
    !safeCallback(gitlabOrigin) ||
    gitlabOrigin.pathname !== "/" ||
    gitlabOrigin.search !== "" ||
    githubClientId.length > 500 ||
    githubClientSecret.length > 2_000 ||
    gitlabClientId.length > 500 ||
    gitlabClientSecret.length > 2_000
  ) {
    throw new ConfigError("PROVIDER_CONFIG_INVALID");
  }
  return {
    github: {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      callbackUrl: githubCallbackUrl.toString(),
    },
    gitlab: {
      clientId: gitlabClientId,
      clientSecret: gitlabClientSecret,
      callbackUrl: gitlabCallbackUrl.toString(),
      origin: gitlabOrigin.toString(),
    },
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
  const abuseHmacKeys = parseSensitiveDataKeys(
    input.ABUSE_HMAC_KEYS,
    input.ABUSE_HMAC_ACTIVE_KEY_ID,
    [
      accessProofEnvelopeKey,
      providerGrantEnvelopeKey,
      ...Object.values(sensitiveDataKeys.keys),
    ],
  );
  const providers = parseProviders(input);
  const providerOutboxTriggerSecret = parseOptionalTriggerSecret(
    input.PROVIDER_OUTBOX_TRIGGER_SECRET,
  );
  return {
    environment,
    backendEnvironment,
    appwriteEndpoint: parseEndpoint(input.APPWRITE_ENDPOINT, environment),
    appwriteProjectId: requireValue(input.APPWRITE_PROJECT_ID),
    appwriteApiKey: requireValue(input.APPWRITE_API_KEY),
    webOrigin: parseWebOrigin(input.Y7_WEB_ORIGIN, environment),
    ...(providerOutboxTriggerSecret === undefined
      ? {}
      : { providerOutboxTriggerSecret }),
    appwriteSchema: parseAppwriteSchema(input),
    accessProofEnvelopeKey,
    providerGrantEnvelopeKey,
    sensitiveDataActiveKeyId: sensitiveDataKeys.activeKeyId,
    sensitiveDataEnvelopeKeys: sensitiveDataKeys.keys,
    abuseHmacActiveKeyId: abuseHmacKeys.activeKeyId,
    abuseHmacKeys: abuseHmacKeys.keys,
    ...(providers === undefined ? {} : { providers }),
    release: requireValue(input.RELEASE),
  };
}
