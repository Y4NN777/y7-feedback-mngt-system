import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface ProviderMessageFanoutInput {
  readonly transactionId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly messageId: string;
  readonly actorKind: "reporter" | "workspace";
  readonly audience: "reporter" | "workspace";
  readonly content: string;
  readonly occurredAt: string;
}

export interface ProviderMessageFanout {
  append(input: ProviderMessageFanoutInput): Promise<{ readonly queued: number }>;
}

export interface AppwriteProviderMessageFanoutSchema {
  readonly databaseId: string;
  readonly externalIssueLinksTableId: string;
  readonly publicationConsentsTableId: string;
  readonly providerSyncOutboxTableId: string;
}

export interface AppwriteProviderMessageFanoutTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId: string;
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

export interface AppwriteProviderMessageFanoutQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderDesc(attribute: string): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
/* v8 ignore start -- Node SDK query adaptation is exercised by deployed verification. */
const defaultQueries: AppwriteProviderMessageFanoutQueryPort = {
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function createAppwriteProviderMessageFanout(
  tables: AppwriteProviderMessageFanoutTablesPort,
  schema: AppwriteProviderMessageFanoutSchema,
  queries: AppwriteProviderMessageFanoutQueryPort,
  persistence: AppwriteSensitivePersistence,
): ProviderMessageFanout {
  const ids = Object.values(schema) as readonly string[];
  if (
    ids.some((id) => !identifier.test(id)) ||
    new Set(ids.slice(1)).size !== ids.length - 1
  )
    throw new Error("PROVIDER_MESSAGE_FANOUT_SCHEMA_INVALID");
  return {
    async append(input) {
      if (input.audience !== "reporter") return { queued: 0 };
      if (
        !identifier.test(input.transactionId) ||
        !identifier.test(input.feedbackId) ||
        !identifier.test(input.workspaceId) ||
        !identifier.test(input.projectId) ||
        !identifier.test(input.messageId) ||
        input.content.length < 1 ||
        input.content.length > 10_000 ||
        !Number.isFinite(Date.parse(input.occurredAt))
      )
        throw new Error("PROVIDER_MESSAGE_FANOUT_INPUT_INVALID");
      const links = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.externalIssueLinksTableId,
        queries: [
          queries.equal("feedbackId", [input.feedbackId]),
          queries.equal("state", ["active"]),
          queries.limit(2),
        ],
        total: false,
        ttl: 0,
        transactionId: input.transactionId,
      });
      if (links.rows.length === 0) return { queued: 0 };
      const link = links.rows[0];
      if (
        links.rows.length !== 1 ||
        !object(link) ||
        typeof link.$id !== "string" ||
        !identifier.test(link.$id) ||
        link.feedbackId !== input.feedbackId ||
        link.workspaceId !== input.workspaceId ||
        link.projectId !== input.projectId ||
        typeof link.connectionId !== "string" ||
        !identifier.test(link.connectionId) ||
        (link.provider !== "github" && link.provider !== "gitlab") ||
        typeof link.repositoryId !== "string" ||
        link.repositoryId.length < 1 ||
        link.repositoryId.length > 100 ||
        typeof link.providerIssueId !== "string" ||
        link.providerIssueId.length < 1 ||
        link.providerIssueId.length > 100 ||
        (link.visibility !== "public" && link.visibility !== "private")
      )
        throw new Error("PROVIDER_MESSAGE_FANOUT_STATE_INVALID");
      if (link.visibility === "public" && input.actorKind === "reporter") {
        const consent = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.publicationConsentsTableId,
          queries: [
            queries.equal("feedbackId", [input.feedbackId]),
            queries.orderDesc("version"),
            queries.limit(1),
          ],
          total: false,
          ttl: 0,
          transactionId: input.transactionId,
        });
        const latest = consent.rows[0];
        if (
          consent.rows.length !== 1 ||
          !object(latest) ||
          latest.feedbackId !== input.feedbackId ||
          latest.state !== "active" ||
          latest.audience !== `${link.provider}:${link.repositoryId}` ||
          typeof latest.version !== "number" ||
          !Number.isSafeInteger(latest.version)
        )
          return { queued: 0 };
      }
      const prior = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.providerSyncOutboxTableId,
        queries: [
          queries.equal("linkId", [link.$id]),
          queries.orderDesc("sequence"),
          queries.limit(1),
        ],
        total: false,
        ttl: 0,
        transactionId: input.transactionId,
      });
      const latest = prior.rows[0];
      if (
        latest !== undefined &&
        (!object(latest) ||
          latest.linkId !== link.$id ||
          typeof latest.sequence !== "number" ||
          !Number.isSafeInteger(latest.sequence) ||
          latest.sequence < 1)
      )
        throw new Error("PROVIDER_MESSAGE_FANOUT_STATE_INVALID");
      const sequence = latest === undefined ? 1 : Number(latest.sequence) + 1;
      const operationId = input.messageId;
      const rowId = stableId("psyn_", link.$id, operationId);
      const payload = JSON.stringify({
        kind: "publish_message",
        messageId: input.messageId,
        issueId: link.providerIssueId,
        content: input.content,
      });
      const created = await tables.createRow({
        databaseId: schema.databaseId,
        tableId: schema.providerSyncOutboxTableId,
        rowId,
        data: {
          operationId,
          linkId: link.$id,
          feedbackId: input.feedbackId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          connectionId: link.connectionId,
          provider: link.provider,
          repositoryId: link.repositoryId,
          kind: "publish_message",
          status: "pending",
          sequence,
          attempts: 0,
          payloadEnvelope: persistence.protector.seal(
            {
              environment: persistence.environment,
              tableId: schema.providerSyncOutboxTableId,
              rowId,
              field: "payloadEnvelope",
            },
            payload,
          ),
          payloadDigest: digest(payload),
          originMarker: `y7msg:${input.messageId}`,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        permissions: [],
        transactionId: input.transactionId,
      });
      if (!object(created) || created.$id !== rowId)
        throw new Error("PROVIDER_MESSAGE_FANOUT_WRITE_INVALID");
      return { queued: 1 };
    },
  };
}

/* v8 ignore start -- Node SDK adaptation is covered by deployed Preview verification. */
export function createNodeAppwriteProviderMessageFanout(
  tables: TablesDB,
  schema: AppwriteProviderMessageFanoutSchema,
  persistence: AppwriteSensitivePersistence,
): ProviderMessageFanout {
  return createAppwriteProviderMessageFanout(
    {
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
