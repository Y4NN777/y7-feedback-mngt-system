import { Query, type TablesDB } from "node-appwrite";

import {
  decidePrivacyDeletion,
  type PrivacyDeletionEvent,
  type PrivacyDeletionRecord,
} from "@y7-feedback/domain";

import type { PrivacyStore, TrustedPrivacyCommand } from "./privacy.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwritePrivacySchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly reportersTableId: string;
  readonly accessGrantsTableId: string;
  readonly attachmentsTableId: string;
  readonly notificationsTableId: string;
  readonly publicationConsentsTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly offlineConflictProjectionsTableId: string;
  readonly intelligenceProvenanceTableId: string;
  readonly deletionRecordsTableId: string;
}

export interface AppwritePrivacyTables {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
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
    readonly permissions: readonly [];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwritePrivacyQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface AppwritePrivacyDependencies {
  readonly createId: () => string;
  readonly createEventId: () => string;
  readonly now: () => string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/* v8 ignore start -- SDK serialization is covered by the Preview verifier. */
const nodeQueries: AppwritePrivacyQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openAudit(
  row: Readonly<Record<string, unknown>>,
  schema: AppwritePrivacySchema,
  sensitive: AppwriteSensitivePersistence,
): readonly PrivacyDeletionEvent[] {
  if (typeof row.$id !== "string" || typeof row.auditEnvelope !== "string")
    throw new Error("APPWRITE_PRIVACY_UNAVAILABLE");
  try {
    const value: unknown = JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId: schema.deletionRecordsTableId,
          rowId: row.$id,
          field: "auditEnvelope",
        },
        row.auditEnvelope,
      ),
    );
    if (!Array.isArray(value)) throw new Error("invalid");
    return value as readonly PrivacyDeletionEvent[];
  } catch {
    throw new Error("APPWRITE_PRIVACY_UNAVAILABLE");
  }
}

function deletionRecord(
  row: unknown,
  schema: AppwritePrivacySchema,
  sensitive: AppwriteSensitivePersistence,
): PrivacyDeletionRecord {
  if (
    !object(row) ||
    typeof row.feedbackId !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.projectId !== "string" ||
    (row.requesterKind !== "principal" && row.requesterKind !== "access_proof") ||
    typeof row.requesterDigest !== "string" ||
    typeof row.reasonCode !== "string" ||
    typeof row.requestedAt !== "string" ||
    typeof row.purgeEligibleAt !== "string" ||
    !Number.isSafeInteger(row.revision) ||
    row.identityErased !== true ||
    (row.state !== "soft_deleted" && row.state !== "restored" && row.state !== "purged")
  )
    throw new Error("APPWRITE_PRIVACY_UNAVAILABLE");
  const events = openAudit(row, schema, sensitive);
  return {
    feedbackId: row.feedbackId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    state: row.state,
    requesterKind: row.requesterKind,
    requesterDigest: row.requesterDigest,
    reasonCode: row.reasonCode,
    requestedAt: row.requestedAt,
    purgeEligibleAt: row.purgeEligibleAt,
    revision: Number(row.revision),
    identityErased: true,
    ...(typeof row.restoredAt === "string" ? { restoredAt: row.restoredAt } : {}),
    ...(typeof row.purgedAt === "string" ? { purgedAt: row.purgedAt } : {}),
    events,
  };
}

function domainCommand(input: {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly requesterKind: "principal" | "access_proof";
  readonly requesterDigest: string;
  readonly command: TrustedPrivacyCommand;
}) {
  return input.command.kind === "request_deletion"
    ? ({
        type: "request_deletion",
        operationId: input.command.operationId,
        feedbackId: input.command.feedbackId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        requesterKind: input.requesterKind,
        requesterDigest: input.requesterDigest,
        reasonCode: input.command.reasonCode,
      } as const)
    : ({
        type: "restore_feedback",
        operationId: input.command.operationId,
        expectedRevision: input.command.expectedRevision,
      } as const);
}

export function createAppwritePrivacyStore(
  tables: AppwritePrivacyTables,
  schema: AppwritePrivacySchema,
  queries: AppwritePrivacyQueries,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePrivacyDependencies,
): PrivacyStore {
  const tableIds = [
    schema.feedbackTableId,
    schema.reportersTableId,
    schema.accessGrantsTableId,
    schema.attachmentsTableId,
    schema.notificationsTableId,
    schema.publicationConsentsTableId,
    schema.externalIssueLinksTableId,
    schema.offlineConflictProjectionsTableId,
    schema.intelligenceProvenanceTableId,
    schema.deletionRecordsTableId,
  ];
  if (
    !id.test(schema.databaseId) ||
    tableIds.some((value) => !id.test(value)) ||
    new Set(tableIds).size !== tableIds.length
  )
    throw new Error("APPWRITE_PRIVACY_SCHEMA_INVALID");
  const list = (
    tableId: string,
    feedbackId: string,
    transactionId: string,
    extra: readonly string[] = [],
  ) =>
    tables.listRows({
      databaseId: schema.databaseId,
      tableId,
      queries: [
        queries.equal("feedbackId", [feedbackId]),
        ...extra,
        queries.limit(500),
      ],
      total: false,
      ttl: 0,
      transactionId,
    });
  return {
    async execute(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!id.test(transaction.$id)) throw new Error("unavailable");
        transactionId = transaction.$id;
        const feedback = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.command.feedbackId,
          transactionId,
        });
        if (
          !object(feedback) ||
          feedback.$id !== input.command.feedbackId ||
          feedback.workspaceId !== input.workspaceId ||
          feedback.projectId !== input.projectId ||
          typeof feedback.reporterId !== "string"
        ) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "denied" };
        }
        const existingRows = await list(
          schema.deletionRecordsTableId,
          input.command.feedbackId,
          transactionId,
        );
        if (existingRows.rows.length > 1) throw new Error("unavailable");
        const existingRow = existingRows.rows[0];
        const existing =
          existingRow === undefined
            ? undefined
            : deletionRecord(existingRow, schema, sensitive);
        if (
          existing &&
          (existing.workspaceId !== input.workspaceId ||
            existing.projectId !== input.projectId ||
            existing.feedbackId !== input.command.feedbackId)
        ) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "denied" };
        }
        const decision = decidePrivacyDeletion(existing, domainCommand(input), {
          actorDigest: input.actorDigest,
          createEventId: dependencies.createEventId,
          now: dependencies.now,
        });
        if (decision.status === "replayed") {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return {
            status: "replayed",
            feedbackId: decision.record.feedbackId,
            revision: decision.record.revision,
            purgeEligibleAt: decision.record.purgeEligibleAt,
          };
        }
        if (decision.status !== "accepted") {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return {
            status:
              /* v8 ignore next -- this store exposes request/restore, never purge. */
              decision.status === "too_early" || decision.status === "irreversible"
                ? "conflict"
                : decision.status,
          };
        }
        const record = decision.record;
        const deletionId =
          object(existingRow) && typeof existingRow.$id === "string"
            ? existingRow.$id
            : dependencies.createId();
        if (!id.test(deletionId)) throw new Error("unavailable");
        const auditEnvelope = sensitive.protector.seal(
          {
            environment: sensitive.environment,
            tableId: schema.deletionRecordsTableId,
            rowId: deletionId,
            field: "auditEnvelope",
          },
          JSON.stringify(record.events),
        );
        const data = {
          feedbackId: record.feedbackId,
          workspaceId: record.workspaceId,
          projectId: record.projectId,
          requesterKind: record.requesterKind,
          requesterDigest: record.requesterDigest,
          state: record.state,
          reasonCode: record.reasonCode,
          requestedAt: record.requestedAt,
          softDeletedAt: record.requestedAt,
          purgeEligibleAt: record.purgeEligibleAt,
          revision: record.revision,
          identityErased: true,
          auditEnvelope,
          operationIdsJson: JSON.stringify(
            record.events.map(({ operationId }) => operationId),
          ),
          updatedAt: decision.event.occurredAt,
          ...(record.restoredAt ? { restoredAt: record.restoredAt } : {}),
          /* v8 ignore next -- physical purge is committed by the purge repository. */
          ...(record.purgedAt ? { purgedAt: record.purgedAt } : {}),
        };
        if (existingRow === undefined)
          await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.deletionRecordsTableId,
            rowId: deletionId,
            data,
            permissions: [],
            transactionId,
          });
        else
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.deletionRecordsTableId,
            rowId: deletionId,
            data,
            transactionId,
          });
        const deleting = input.command.kind === "request_deletion";
        await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          rowId: input.command.feedbackId,
          data: { deletedAt: deleting ? decision.event.occurredAt : null },
          transactionId,
        });
        const attachments = await list(
          schema.attachmentsTableId,
          input.command.feedbackId,
          transactionId,
        );
        for (const row of attachments.rows) {
          if (!object(row) || typeof row.$id !== "string")
            throw new Error("unavailable");
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.attachmentsTableId,
            rowId: row.$id,
            data: { lifecycle: deleting ? "soft_deleted" : "available" },
            transactionId,
          });
        }
        if (deleting) {
          const grants = await list(
            schema.accessGrantsTableId,
            input.command.feedbackId,
            transactionId,
          );
          for (const row of grants.rows) {
            if (!object(row) || typeof row.$id !== "string")
              throw new Error("unavailable");
            await tables.updateRow({
              databaseId: schema.databaseId,
              tableId: schema.accessGrantsTableId,
              rowId: row.$id,
              data: { status: "revoked" },
              transactionId,
            });
          }
          for (const tableId of [
            schema.notificationsTableId,
            schema.offlineConflictProjectionsTableId,
            schema.intelligenceProvenanceTableId,
          ]) {
            const rows = await list(tableId, input.command.feedbackId, transactionId);
            for (const row of rows.rows) {
              if (!object(row) || typeof row.$id !== "string")
                throw new Error("unavailable");
              await tables.deleteRow({
                databaseId: schema.databaseId,
                tableId,
                rowId: row.$id,
                transactionId,
              });
            }
          }
          const otherFeedback = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            queries: [
              queries.equal("reporterId", [feedback.reporterId]),
              queries.limit(500),
            ],
            total: false,
            ttl: 0,
            transactionId,
          });
          const hasOtherActive = otherFeedback.rows.some(
            (row) =>
              object(row) &&
              row.$id !== input.command.feedbackId &&
              (row.deletedAt === undefined || row.deletedAt === null),
          );
          if (!hasOtherActive) {
            await tables.updateRow({
              databaseId: schema.databaseId,
              tableId: schema.reportersTableId,
              rowId: feedback.reporterId,
              data: {
                attributionJson: sensitive.protector.seal(
                  {
                    environment: sensitive.environment,
                    tableId: schema.reportersTableId,
                    rowId: feedback.reporterId,
                    field: "attributionJson",
                  },
                  JSON.stringify({ kind: "unidentified" }),
                ),
              },
              transactionId,
            });
          }
          const links = await list(
            schema.externalIssueLinksTableId,
            input.command.feedbackId,
            transactionId,
          );
          for (const row of links.rows) {
            if (!object(row) || typeof row.$id !== "string")
              throw new Error("unavailable");
            await tables.updateRow({
              databaseId: schema.databaseId,
              tableId: schema.externalIssueLinksTableId,
              rowId: row.$id,
              data: { synchronizationState: "privacy_cleanup_pending" },
              transactionId,
            });
          }
          const consents = await list(
            schema.publicationConsentsTableId,
            input.command.feedbackId,
            transactionId,
          );
          const latestConsent = consents.rows
            .filter(
              (row): row is Readonly<Record<string, unknown>> =>
                object(row) && Number.isSafeInteger(row.version),
            )
            .sort((left, right) => Number(right.version) - Number(left.version))[0];
          if (latestConsent?.state === "active") {
            if (
              typeof latestConsent.reporterId !== "string" ||
              typeof latestConsent.disclosureVersion !== "string" ||
              typeof latestConsent.audience !== "string"
            )
              throw new Error("unavailable");
            const consentId = dependencies.createId();
            if (!id.test(consentId)) throw new Error("unavailable");
            await tables.createRow({
              databaseId: schema.databaseId,
              tableId: schema.publicationConsentsTableId,
              rowId: consentId,
              permissions: [],
              transactionId,
              data: {
                feedbackId: input.command.feedbackId,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                reporterId: latestConsent.reporterId,
                operationId: decision.event.eventId,
                payloadDigest: input.actorDigest,
                version: Number(latestConsent.version) + 1,
                state: "revoked",
                disclosureVersion: latestConsent.disclosureVersion,
                audience: latestConsent.audience,
                occurredAt: decision.event.occurredAt,
              },
            });
          }
        }
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return {
          status: "applied",
          feedbackId: record.feedbackId,
          revision: record.revision,
          purgeEligibleAt: record.purgeEligibleAt,
        };
      } catch {
        if (transactionId && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // Preserve a stable retryable result.
          }
        }
        return { status: "retryable" };
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is covered by the Preview verifier. */
export function createNodeAppwritePrivacyStore(
  tables: TablesDB,
  schema: AppwritePrivacySchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePrivacyDependencies,
): PrivacyStore {
  return createAppwritePrivacyStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      updateRow: (input) => tables.updateRow(input),
      deleteRow: (input) => tables.deleteRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    nodeQueries,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */
