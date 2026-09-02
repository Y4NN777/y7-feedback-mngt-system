/* v8 ignore file */
// Appwrite adapter behavior is covered by its contract suite and deployed Preview verification.
import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";
import type {
  ProviderMessageContext,
  ProviderMessageContextResolver,
  ProviderMessageFactStore,
  ProviderMessageObservation,
} from "./provider-message-event.js";

export interface AppwriteProviderMessageSchema {
  readonly databaseId: string;
  readonly sourceConnectionsTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly conversationMessagesTableId: string;
}

export interface AppwriteProviderMessageTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId?: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId?: string;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteProviderMessageQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderDesc(attribute: string): string;
  limit(value: number): string;
}

export type AppwriteProviderMessageStore = ProviderMessageContextResolver &
  ProviderMessageFactStore;

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const externalId = /^[^\p{Cc}\p{Cf}]{1,128}$/u;
/* v8 ignore start -- Node SDK query adaptation is exercised by deployed verification. */
const defaultQueries: AppwriteProviderMessageQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderDesc: (attribute) => Query.orderDesc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 31)}`;
}

function validObservation(value: ProviderMessageObservation): boolean {
  return (
    appwriteId.test(value.connectionId) &&
    appwriteId.test(value.workspaceId) &&
    appwriteId.test(value.projectId) &&
    externalId.test(value.repositoryId) &&
    externalId.test(value.issueId) &&
    externalId.test(value.commentId) &&
    externalId.test(value.deliveryId) &&
    externalId.test(value.authorId) &&
    value.authorLogin.length > 0 &&
    value.authorLogin.length <= 200 &&
    Number.isFinite(Date.parse(value.providerUpdatedAt)) &&
    (value.mutation === "tombstoned" ||
      (typeof value.content === "string" &&
        value.content.length > 0 &&
        value.content.length <= 10_000))
  );
}

function activeLink(value: unknown, expected: ProviderMessageObservation) {
  return (
    object(value) &&
    typeof value.$id === "string" &&
    appwriteId.test(value.$id) &&
    typeof value.feedbackId === "string" &&
    appwriteId.test(value.feedbackId) &&
    value.workspaceId === expected.workspaceId &&
    value.projectId === expected.projectId &&
    value.connectionId === expected.connectionId &&
    value.provider === expected.provider &&
    value.repositoryId === expected.repositoryId &&
    value.providerIssueId === expected.issueId &&
    value.state === "active"
  );
}

function repository(
  value: unknown,
  expected: ProviderMessageObservation,
):
  | {
      readonly encryptedGrantRef: string;
      readonly repositoryOwner: string;
      readonly repositoryName: string;
    }
  | undefined {
  if (
    !object(value) ||
    value.$id !== expected.connectionId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    value.provider !== expected.provider ||
    value.status !== "active" ||
    typeof value.encryptedGrantRef !== "string" ||
    !appwriteId.test(value.encryptedGrantRef) ||
    typeof value.selectedRepositoriesJson !== "string"
  )
    return undefined;
  try {
    const parsed: unknown = JSON.parse(value.selectedRepositoriesJson);
    if (!object(parsed) || !Array.isArray(parsed.imports)) return undefined;
    const imports = parsed.imports as readonly unknown[];
    const matches = imports.filter(
      (entry) =>
        object(entry) &&
        entry.connectionId === expected.connectionId &&
        entry.provider === expected.provider &&
        entry.repositoryId === expected.repositoryId,
    );
    const match = matches[0];
    if (
      matches.length !== 1 ||
      !object(match) ||
      typeof match.owner !== "string" ||
      match.owner.length === 0 ||
      match.owner.length > 200 ||
      typeof match.name !== "string" ||
      match.name.length === 0 ||
      match.name.length > 200
    )
      return undefined;
    return {
      encryptedGrantRef: value.encryptedGrantRef,
      repositoryOwner: match.owner,
      repositoryName: match.name,
    };
  } catch {
    return undefined;
  }
}

function currentMessage(
  value: unknown,
  expected: ProviderMessageContext,
): Readonly<Record<string, unknown>> | undefined {
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.feedbackId !== expected.feedbackId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    value.origin !== "provider" ||
    value.provider !== expected.provider ||
    value.repositoryId !== expected.repositoryId ||
    value.providerIssueId !== expected.issueId ||
    value.providerCommentId !== expected.commentId ||
    typeof value.providerUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.providerUpdatedAt))
  )
    return undefined;
  return value;
}

export function createAppwriteProviderMessageStore(
  tables: AppwriteProviderMessageTablesPort,
  schema: AppwriteProviderMessageSchema,
  queries: AppwriteProviderMessageQueryPort,
  persistence: AppwriteSensitivePersistence,
): AppwriteProviderMessageStore {
  const ids = Object.values(schema) as readonly string[];
  if (
    ids.some((id) => !appwriteId.test(id)) ||
    new Set(ids.slice(1)).size !== ids.length - 1
  )
    throw new Error("APPWRITE_PROVIDER_MESSAGE_SCHEMA_INVALID");

  return {
    async resolve(observation) {
      if (!validObservation(observation)) return { status: "permanent" };
      try {
        const links = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          queries: [
            queries.equal("provider", [observation.provider]),
            queries.equal("repositoryId", [observation.repositoryId]),
            queries.equal("providerIssueId", [observation.issueId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 60,
        });
        if (links.rows.length === 0) return { status: "ignored" };
        const link = links.rows[0];
        if (links.rows.length !== 1 || !activeLink(link, observation))
          return { status: "permanent" };
        const selected = repository(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.sourceConnectionsTableId,
            rowId: observation.connectionId,
          }),
          observation,
        );
        if (!selected) return { status: "ignored" };
        return {
          status: "resolved",
          context: {
            ...observation,
            linkId: String((link as Readonly<Record<string, unknown>>).$id),
            feedbackId: String((link as Readonly<Record<string, unknown>>).feedbackId),
            ...selected,
          },
        };
      } catch {
        return { status: "retryable" };
      }
    },

    async apply(context) {
      if (!validObservation(context) || !appwriteId.test(context.linkId))
        return "permanent";
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id))
        throw new Error("APPWRITE_PROVIDER_MESSAGE_TX_INVALID");
      try {
        const link = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: context.linkId,
          transactionId: transaction.$id,
        });
        if (
          !activeLink(link, context) ||
          (link as Readonly<Record<string, unknown>>).feedbackId !== context.feedbackId
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
          return "ignored";
        }
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.conversationMessagesTableId,
          queries: [
            queries.equal("provider", [context.provider]),
            queries.equal("repositoryId", [context.repositoryId]),
            queries.equal("providerCommentId", [context.commentId]),
            queries.orderDesc("providerUpdatedAt"),
            queries.limit(2),
          ],
          total: false,
          ttl: 60,
          transactionId: transaction.$id,
        });
        const prior = listed.rows[0];
        const current =
          prior === undefined ? undefined : currentMessage(prior, context);
        if (prior !== undefined && !current)
          throw new Error("APPWRITE_PROVIDER_MESSAGE_ROW_INVALID");
        if (
          current &&
          (current.providerEventId === context.deliveryId ||
            String(current.providerUpdatedAt) >= context.providerUpdatedAt)
        ) {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            commit: true,
          });
          return "ignored";
        }
        const rowId = stableId(
          "pmsg_",
          context.provider,
          context.repositoryId,
          context.commentId,
          context.providerUpdatedAt,
          context.mutation,
        );
        const content =
          context.mutation === "tombstoned"
            ? "External message deleted."
            : context.content;
        if (!content) return "permanent";
        const author = JSON.stringify({
          id: context.authorId,
          login: context.authorLogin,
        });
        const created = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.conversationMessagesTableId,
          rowId,
          data: {
            feedbackId: context.feedbackId,
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            actorId: stableId("ext_", context.provider, context.authorId),
            actorKind: "workspace",
            audience: "reporter",
            contentEnvelope: persistence.protector.seal(
              {
                environment: persistence.environment,
                tableId: schema.conversationMessagesTableId,
                rowId,
                field: "contentEnvelope",
              },
              content,
            ),
            occurredAt: context.providerUpdatedAt,
            origin: "provider",
            providerLinkId: context.linkId,
            provider: context.provider,
            repositoryId: context.repositoryId,
            providerIssueId: context.issueId,
            providerCommentId: context.commentId,
            providerEventId: context.deliveryId,
            providerAuthorEnvelope: persistence.protector.seal(
              {
                environment: persistence.environment,
                tableId: schema.conversationMessagesTableId,
                rowId,
                field: "providerAuthorEnvelope",
              },
              author,
            ),
            revisionKind: context.mutation,
            ...(current === undefined ? {} : { supersedesMessageId: current.$id }),
            providerUpdatedAt: context.providerUpdatedAt,
          },
          permissions: [],
          transactionId: transaction.$id,
        });
        if (!object(created) || created.$id !== rowId)
          throw new Error("APPWRITE_PROVIDER_MESSAGE_WRITE_INVALID");
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
        return "applied";
      } catch (error) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // Preserve the originating failure; Appwrite expires abandoned transactions.
        }
        throw error;
      }
    },
  };
}

/* v8 ignore start -- Node SDK adaptation is covered by deployed Preview verification. */
export function createNodeAppwriteProviderMessageStore(
  tables: TablesDB,
  schema: AppwriteProviderMessageSchema,
  persistence: AppwriteSensitivePersistence,
): AppwriteProviderMessageStore {
  return createAppwriteProviderMessageStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const rows = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: rows.rows };
      },
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
    },
    schema,
    defaultQueries,
    persistence,
  );
}
/* v8 ignore stop */
