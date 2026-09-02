import type { SourceProvider } from "@y7-feedback/domain";

import type {
  ProviderWebhookAuthority,
  ProviderWebhookAuthorityStore,
} from "./provider-webhook-ingress.js";
import type { ProviderWebhookCredential } from "./provider-webhook-auth.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteProviderWebhookAuthoritySchema {
  readonly databaseId: string;
  readonly sourceConnectionsTableId: string;
  readonly providerGrantsTableId: string;
}

export interface AppwriteProviderWebhookAuthorityTablesPort {
  readonly getRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }) => Promise<unknown>;
  readonly updateRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }) => Promise<unknown>;
}

export interface ProviderWebhookCredentialWriter {
  readonly save: (input: {
    readonly provider: SourceProvider;
    readonly encryptedGrantRef: string;
    readonly credential: ProviderWebhookCredential;
  }) => Promise<void>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const repositoryId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credential(
  value: unknown,
  provider: SourceProvider,
): ProviderWebhookCredential {
  if (!object(value)) throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
  const keys = Object.keys(value).sort().join(",");
  if (
    provider === "github" &&
    keys === "kind,secret" &&
    value.kind === "github_hmac" &&
    typeof value.secret === "string" &&
    value.secret.length >= 32 &&
    value.secret.length <= 512
  ) {
    return { kind: "github_hmac", secret: value.secret };
  }
  if (
    provider === "gitlab" &&
    keys === "kind,signingToken" &&
    value.kind === "gitlab_hmac" &&
    typeof value.signingToken === "string" &&
    /^whsec_[A-Za-z0-9+/]+={0,2}$/u.test(value.signingToken) &&
    Buffer.from(value.signingToken.slice(6), "base64").byteLength === 32
  ) {
    return { kind: "gitlab_hmac", signingToken: value.signingToken };
  }
  if (
    provider === "gitlab" &&
    keys === "kind,secret" &&
    value.kind === "gitlab_legacy" &&
    typeof value.secret === "string" &&
    value.secret.length >= 32 &&
    value.secret.length <= 512
  ) {
    return { kind: "gitlab_legacy", secret: value.secret };
  }
  throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
}

function selectedRepository(value: unknown, provider: SourceProvider): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !object(parsed) ||
      parsed.kind !== "selected" ||
      !Array.isArray(parsed.repositories)
    ) {
      return null;
    }
    const matches = parsed.repositories.filter(
      (entry) =>
        object(entry) &&
        entry.provider === provider &&
        typeof entry.id === "string" &&
        repositoryId.test(entry.id),
    );
    return matches.length === 1 && object(matches[0]) ? String(matches[0].id) : null;
  } catch {
    return null;
  }
}

export function createAppwriteProviderWebhookAuthorityStore(
  tables: AppwriteProviderWebhookAuthorityTablesPort,
  schema: AppwriteProviderWebhookAuthoritySchema,
  sensitive: AppwriteSensitivePersistence,
): ProviderWebhookAuthorityStore & ProviderWebhookCredentialWriter {
  const ids: readonly string[] = [
    schema.databaseId,
    schema.sourceConnectionsTableId,
    schema.providerGrantsTableId,
  ];
  if (
    ids.some((value) => !appwriteId.test(value)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("PROVIDER_WEBHOOK_AUTHORITY_SCHEMA_INVALID");
  }

  const context = (rowId: string) => ({
    environment: sensitive.environment,
    tableId: schema.providerGrantsTableId,
    rowId,
    field: "webhookCredentialEnvelope",
  });

  return {
    async resolve(input): Promise<ProviderWebhookAuthority | null> {
      if (!appwriteId.test(input.connectionId)) return null;
      const connection = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.sourceConnectionsTableId,
        rowId: input.connectionId,
      });
      if (
        !object(connection) ||
        connection.$id !== input.connectionId ||
        connection.provider !== input.provider ||
        connection.status !== "active" ||
        typeof connection.workspaceId !== "string" ||
        !appwriteId.test(connection.workspaceId) ||
        typeof connection.projectId !== "string" ||
        !appwriteId.test(connection.projectId) ||
        typeof connection.encryptedGrantRef !== "string" ||
        !appwriteId.test(connection.encryptedGrantRef)
      ) {
        return null;
      }
      const selected = selectedRepository(
        connection.selectedRepositoriesJson,
        input.provider,
      );
      if (!selected) return null;
      const grant = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.providerGrantsTableId,
        rowId: connection.encryptedGrantRef,
      });
      if (
        !object(grant) ||
        grant.$id !== connection.encryptedGrantRef ||
        grant.provider !== input.provider ||
        typeof grant.webhookCredentialEnvelope !== "string"
      ) {
        return null;
      }
      let opened: ProviderWebhookCredential;
      try {
        opened = credential(
          JSON.parse(
            sensitive.protector.open(
              context(connection.encryptedGrantRef),
              grant.webhookCredentialEnvelope,
            ),
          ) as unknown,
          input.provider,
        );
      } catch {
        throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
      }
      return {
        connectionId: input.connectionId,
        workspaceId: connection.workspaceId,
        projectId: connection.projectId,
        repositoryId: selected,
        credential: opened,
        active: true,
      };
    },

    async save(input) {
      if (!appwriteId.test(input.encryptedGrantRef)) {
        throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
      }
      const validated = credential(input.credential, input.provider);
      const current = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.providerGrantsTableId,
        rowId: input.encryptedGrantRef,
      });
      if (
        !object(current) ||
        current.$id !== input.encryptedGrantRef ||
        current.provider !== input.provider
      ) {
        throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
      }
      const updated = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.providerGrantsTableId,
        rowId: input.encryptedGrantRef,
        data: {
          webhookCredentialEnvelope: sensitive.protector.seal(
            context(input.encryptedGrantRef),
            JSON.stringify(validated),
          ),
        },
      });
      if (!object(updated) || updated.$id !== input.encryptedGrantRef) {
        throw new Error("PROVIDER_WEBHOOK_CREDENTIAL_WRITE_INVALID");
      }
    },
  };
}
