import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";

import {
  ExternalIssuePolicyError,
  createExternalIssueLinkRegistry,
  createPublicationConsentLedger,
  validateFeedbackSource,
  type FeedbackSource,
  type PublicationConsentLedger,
  type SourceProvider,
} from "@y7-feedback/domain";

import type { ExternalIssuePersistence } from "./external-issue-coordination.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export class AppwriteExternalIssueError extends Error {
  readonly code: "ERR-ISSUE-DENIED" | "ERR-ISSUE-CONFLICT" | "ERR-ISSUE-RETRYABLE";

  constructor(code: AppwriteExternalIssueError["code"]) {
    super(code);
    this.name = "AppwriteExternalIssueError";
    this.code = code;
  }
}

export interface AppwriteExternalIssueSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly accessGrantsTableId: string;
  readonly sourceConnectionsTableId: string;
  readonly publicationConsentsTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly providerOutboxTableId: string;
}

export interface AppwriteExternalIssueTablesPort {
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
    readonly transactionId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId: string;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: string[];
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteExternalIssueQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const reference = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u;
/* v8 ignore start -- Node Query serialization is exercised by deployed evidence. */
const defaultQueries: AppwriteExternalIssueQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
  );
}

function stableId(prefix: "link" | "pout" | "cons", ...parts: readonly string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 31)}`;
}

function provider(value: unknown): SourceProvider | undefined {
  return value === "github" || value === "gitlab" ? value : undefined;
}

function feedbackRow(
  value: unknown,
  expected: {
    readonly feedbackId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): Readonly<Record<string, unknown>> {
  if (
    !object(value) ||
    value.$id !== expected.feedbackId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    (value.deletedAt !== null && value.deletedAt !== undefined) ||
    typeof value.reporterId !== "string" ||
    !identifier.test(value.reporterId) ||
    (value.type !== "bug" && value.type !== "suggestion" && value.type !== "review")
  ) {
    throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
  }
  return value;
}

function openSource(
  row: Readonly<Record<string, unknown>>,
  schema: AppwriteExternalIssueSchema,
  sensitive: AppwriteSensitivePersistence,
): FeedbackSource {
  if (typeof row.$id !== "string" || typeof row.currentSourceJson !== "string") {
    throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
  }
  try {
    const parsed: unknown = JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId: schema.feedbackTableId,
          rowId: row.$id,
          field: "currentSourceJson",
        },
        row.currentSourceJson,
      ),
    );
    if (!object(parsed) || parsed.type !== row.type) throw new Error("SOURCE_INVALID");
    return validateFeedbackSource(parsed as FeedbackSource);
  } catch {
    throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
  }
}

function selectedRepository(
  value: unknown,
  expected: {
    readonly connectionId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly repositoryId: string;
  },
) {
  if (
    !object(value) ||
    value.$id !== expected.connectionId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    value.status !== "active" ||
    typeof value.selectedRepositoriesJson !== "string"
  ) {
    throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
  }
  const sourceProvider = provider(value.provider);
  if (!sourceProvider) throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
  try {
    const parsed: unknown = JSON.parse(value.selectedRepositoriesJson);
    if (!object(parsed) || parsed.kind !== "selected") throw new Error("INVALID");
    const repositoryValues = parsed.repositories;
    const importValues = parsed.imports;
    if (!Array.isArray(repositoryValues) || !Array.isArray(importValues)) {
      throw new Error("INVALID");
    }
    const repositories = repositoryValues as readonly unknown[];
    const imports = importValues as readonly unknown[];
    const selected = repositories.some(
      (entry) =>
        object(entry) &&
        entry.provider === sourceProvider &&
        entry.id === expected.repositoryId,
    );
    const imported = imports.find(
      (entry) =>
        object(entry) &&
        entry.connectionId === expected.connectionId &&
        entry.provider === sourceProvider &&
        entry.repositoryId === expected.repositoryId,
    );
    if (
      !selected ||
      !object(imported) ||
      (imported.visibility !== "public" &&
        imported.visibility !== "private" &&
        imported.visibility !== "internal")
    ) {
      throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
    }
    return {
      provider: sourceProvider,
      visibility: imported.visibility === "public" ? "public" : "private",
    } as const;
  } catch (error) {
    if (error instanceof AppwriteExternalIssueError) throw error;
    throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
  }
}

function rebuildConsent(
  rows: readonly unknown[],
  feedbackId: string,
): PublicationConsentLedger {
  const ledger = createPublicationConsentLedger();
  let expectedVersion = 1;
  for (const value of rows) {
    if (
      !object(value) ||
      value.feedbackId !== feedbackId ||
      value.version !== expectedVersion ||
      typeof value.reporterId !== "string" ||
      typeof value.disclosureVersion !== "string" ||
      typeof value.audience !== "string" ||
      typeof value.occurredAt !== "string" ||
      (value.state !== "active" && value.state !== "revoked")
    ) {
      throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
    }
    if (value.state === "active") {
      ledger.grant({
        feedbackId,
        reporterId: value.reporterId,
        disclosureVersion: value.disclosureVersion,
        audience: value.audience,
        occurredAt: value.occurredAt,
      });
    } else {
      ledger.revoke({
        feedbackId,
        reporterId: value.reporterId,
        occurredAt: value.occurredAt,
      });
    }
    expectedVersion += 1;
  }
  return ledger;
}

function validateSchema(schema: AppwriteExternalIssueSchema): void {
  const values = Object.values(schema) as readonly string[];
  const tableIds = values.slice(1);
  if (
    values.some((value) => !identifier.test(value)) ||
    new Set(tableIds).size !== tableIds.length
  ) {
    throw new Error("APPWRITE_EXTERNAL_ISSUE_SCHEMA_INVALID");
  }
}

function actorAssignments(row: Readonly<Record<string, unknown>>): readonly string[] {
  return typeof row.assignedMaintainerId === "string" &&
    identifier.test(row.assignedMaintainerId)
    ? [row.assignedMaintainerId]
    : [];
}

function mapPolicyError(error: unknown): AppwriteExternalIssueError {
  if (error instanceof AppwriteExternalIssueError) return error;
  if (error instanceof ExternalIssuePolicyError) {
    return new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
  }
  return new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
}

export function createAppwriteExternalIssueStore(
  tables: AppwriteExternalIssueTablesPort,
  schema: AppwriteExternalIssueSchema,
  sensitive: AppwriteSensitivePersistence,
  queries: AppwriteExternalIssueQueryPort = defaultQueries,
): ExternalIssuePersistence {
  validateSchema(schema);

  async function transaction<T>(operation: (transactionId: string) => Promise<T>) {
    const created = await tables.createTransaction({ ttl: 60 });
    if (!identifier.test(created.$id)) {
      throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
    }
    try {
      const result = await operation(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        // Preserve the originating stable failure.
      }
      throw mapPolicyError(error);
    }
  }

  const list = (tableId: string, transactionId: string, queryValues: string[]) =>
    tables.listRows({
      databaseId: schema.databaseId,
      tableId,
      queries: queryValues,
      total: false,
      ttl: 0,
      transactionId,
    });

  async function consentRows(feedbackId: string, transactionId: string) {
    return list(schema.publicationConsentsTableId, transactionId, [
      queries.equal("feedbackId", [feedbackId]),
      queries.orderAsc("version"),
      queries.limit(100),
    ]);
  }

  interface ConsentPersistenceInput {
    readonly feedbackId: string;
    readonly reporterId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly operationId: string;
    readonly payloadDigest: string;
    readonly disclosureVersion?: string;
    readonly audience?: string;
    readonly occurredAt: string;
  }

  function persistConsent(
    kind: "grant",
    input: ConsentPersistenceInput,
  ): Promise<{ readonly version: number; readonly state: "active" }>;
  function persistConsent(
    kind: "revoke",
    input: ConsentPersistenceInput,
  ): Promise<{ readonly version: number; readonly state: "revoked" }>;
  function persistConsent(
    kind: "grant" | "revoke",
    input: ConsentPersistenceInput,
  ): Promise<{
    readonly version: number;
    readonly state: "active" | "revoked";
  }> {
    return transaction(async (transactionId) => {
      if (
        !identifier.test(input.feedbackId) ||
        !identifier.test(input.reporterId) ||
        !identifier.test(input.workspaceId) ||
        !identifier.test(input.projectId) ||
        !identifier.test(input.operationId) ||
        input.payloadDigest.length < 16 ||
        !timestamp(input.occurredAt)
      ) {
        throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
      }
      const row = feedbackRow(
        await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.feedbackId,
          transactionId,
        }),
        input,
      );
      if (row.reporterId !== input.reporterId) {
        throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
      }
      const existing = await consentRows(input.feedbackId, transactionId);
      const replay = existing.rows.find(
        (candidate) => object(candidate) && candidate.operationId === input.operationId,
      );
      if (object(replay)) {
        const expectedState = kind === "grant" ? "active" : "revoked";
        if (
          replay.payloadDigest !== input.payloadDigest ||
          replay.state !== expectedState
        ) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT");
        }
        if (typeof replay.version !== "number") {
          throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
        }
        return {
          version: replay.version,
          state: expectedState,
        };
      }
      const ledger = rebuildConsent(existing.rows, input.feedbackId);
      const disclosureVersion = input.disclosureVersion;
      const consentAudience = input.audience;
      if (kind === "grant" && (!disclosureVersion || !consentAudience)) {
        throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
      }
      const fact =
        kind === "grant"
          ? ledger.grant({
              feedbackId: input.feedbackId,
              reporterId: input.reporterId,
              disclosureVersion: disclosureVersion as string,
              audience: consentAudience as string,
              occurredAt: input.occurredAt,
            })
          : ledger.revoke({
              feedbackId: input.feedbackId,
              reporterId: input.reporterId,
              occurredAt: input.occurredAt,
            });
      const rowId = stableId("cons", input.feedbackId, String(fact.version));
      const created = await tables.createRow({
        databaseId: schema.databaseId,
        tableId: schema.publicationConsentsTableId,
        rowId,
        data: {
          feedbackId: input.feedbackId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          reporterId: input.reporterId,
          operationId: input.operationId,
          payloadDigest: input.payloadDigest,
          version: fact.version,
          state: fact.state,
          disclosureVersion: fact.disclosureVersion,
          audience: fact.audience,
          occurredAt: fact.occurredAt,
        },
        permissions: [],
        transactionId,
      });
      if (!object(created) || created.$id !== rowId) {
        throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
      }
      return {
        version: fact.version,
        state: kind === "grant" ? ("active" as const) : ("revoked" as const),
      };
    });
  }

  return {
    grantConsent(input) {
      return persistConsent("grant", input);
    },
    revokeConsent(input) {
      return persistConsent("revoke", input);
    },
    requestLink(input) {
      return transaction(async (transactionId) => {
        if (
          !identifier.test(input.feedbackId) ||
          !identifier.test(input.workspaceId) ||
          !identifier.test(input.projectId) ||
          !identifier.test(input.operationId) ||
          !identifier.test(input.connectionId) ||
          !identifier.test(input.repositoryId) ||
          input.payloadDigest.length < 16 ||
          !timestamp(input.occurredAt)
        ) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
        }
        const prior = await list(schema.providerOutboxTableId, transactionId, [
          queries.equal("operationId", [input.operationId]),
          queries.limit(2),
        ]);
        if (prior.rows.length > 1) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
        }
        if (prior.rows.length === 1) {
          const value = prior.rows[0];
          if (
            !object(value) ||
            value.feedbackId !== input.feedbackId ||
            value.workspaceId !== input.workspaceId ||
            value.projectId !== input.projectId ||
            value.payloadDigest !== input.payloadDigest ||
            typeof value.linkId !== "string" ||
            !identifier.test(value.linkId)
          ) {
            throw new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT");
          }
          const link = await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.externalIssueLinksTableId,
            rowId: value.linkId,
            transactionId,
          });
          if (
            !object(link) ||
            link.feedbackId !== input.feedbackId ||
            (link.synchronizationState !== "pending" &&
              link.synchronizationState !== "failed" &&
              link.synchronizationState !== "synchronized")
          ) {
            throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
          }
          return {
            status: "replayed",
            linkId: value.linkId,
            synchronizationState: link.synchronizationState,
          };
        }
        const feedback = feedbackRow(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: input.feedbackId,
            transactionId,
          }),
          input,
        );
        const repository = selectedRepository(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.sourceConnectionsTableId,
            rowId: input.connectionId,
            transactionId,
          }),
          input,
        );
        const grant = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.accessGrantsTableId,
          rowId: input.feedbackId,
          transactionId,
        });
        if (
          !object(grant) ||
          grant.feedbackId !== input.feedbackId ||
          typeof grant.reference !== "string" ||
          !reference.test(grant.reference)
        ) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-DENIED");
        }
        const active = await list(schema.externalIssueLinksTableId, transactionId, [
          queries.equal("feedbackId", [input.feedbackId]),
          queries.equal("state", ["active"]),
          queries.limit(2),
        ]);
        if (active.rows.length > 0) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT");
        }
        const consent = await consentRows(input.feedbackId, transactionId);
        const ledger = rebuildConsent(consent.rows, input.feedbackId);
        const source = openSource(feedback, schema, sensitive);
        const domainResult = createExternalIssueLinkRegistry(ledger).request({
          operationId: input.operationId,
          actor: input.actor,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feedbackId: input.feedbackId,
          assignedPrincipalIds: actorAssignments(feedback),
          repository: {
            connectionId: input.connectionId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            provider: repository.provider,
            repositoryId: input.repositoryId,
            visibility: repository.visibility,
            connectionState: "active",
            selected: true,
          },
          reference: grant.reference,
          protectedWorkspaceUrl: input.protectedWorkspaceUrl,
          feedbackType: source.type,
          reporterContent: JSON.stringify(source),
          consentVersion: input.consentVersion,
        });
        const linkId = stableId("link", input.feedbackId, input.operationId);
        const outboxId = stableId("pout", input.feedbackId, input.operationId);
        const createdLink = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: linkId,
          data: {
            feedbackId: input.feedbackId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            connectionId: input.connectionId,
            provider: repository.provider,
            repositoryId: input.repositoryId,
            visibility: repository.visibility,
            state: "active",
            synchronizationState: "pending",
            actorId: input.actor.principalId,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
          },
          permissions: [],
          transactionId,
        });
        if (!object(createdLink) || createdLink.$id !== linkId) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
        }
        const createdOutbox = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.providerOutboxTableId,
          rowId: outboxId,
          data: {
            operationId: input.operationId,
            feedbackId: input.feedbackId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            linkId,
            connectionId: input.connectionId,
            provider: repository.provider,
            repositoryId: input.repositoryId,
            kind: "create_issue",
            status: "pending",
            attempts: 0,
            payloadJson: JSON.stringify(domainResult.outbox.payload),
            payloadDigest: input.payloadDigest,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
          },
          permissions: [],
          transactionId,
        });
        if (!object(createdOutbox) || createdOutbox.$id !== outboxId) {
          throw new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE");
        }
        return { status: "accepted", linkId, synchronizationState: "pending" };
      });
    },
  };
}

/* v8 ignore start -- Thin Node SDK composition wrapper. */
export function createNodeAppwriteExternalIssueStore(
  tables: TablesDB,
  schema: AppwriteExternalIssueSchema,
  sensitive: AppwriteSensitivePersistence,
): ExternalIssuePersistence {
  return createAppwriteExternalIssueStore(tables, schema, sensitive);
}
/* v8 ignore stop */
