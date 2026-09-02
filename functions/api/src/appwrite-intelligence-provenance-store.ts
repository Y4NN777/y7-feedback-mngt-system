import { Query, type TablesDB } from "node-appwrite";

import {
  decideIntelligenceProvenance,
  projectIntelligenceAssociations,
  type IntelligenceAssociationTarget,
  type IntelligenceProvenanceCommand,
  type IntelligenceProvenanceEvent,
} from "@y7-feedback/domain";

import type {
  TrustedIntelligenceProvenanceCommand,
  IntelligenceProvenanceStore,
} from "./intelligence-provenance.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteIntelligenceProvenanceSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly provenanceTableId: string;
}

export interface AppwriteIntelligenceProvenanceTables {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId: string;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
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
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteIntelligenceProvenanceQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface AppwriteIntelligenceProvenanceDependencies {
  readonly createAssociationId: () => string;
  readonly createEventId: () => string;
  readonly now: () => string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

/* v8 ignore start -- SDK serialization is covered by the deployed verifier */
const nodeQueries: AppwriteIntelligenceProvenanceQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

function open(
  rowId: string,
  tableId: string,
  field: string,
  envelope: unknown,
  sensitive: AppwriteSensitivePersistence,
): unknown {
  if (typeof envelope !== "string")
    throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
  try {
    return JSON.parse(
      sensitive.protector.open(
        { environment: sensitive.environment, tableId, rowId, field },
        envelope,
      ),
    ) as unknown;
  } catch {
    throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
  }
}

function seal(
  rowId: string,
  tableId: string,
  field: string,
  value: unknown,
  sensitive: AppwriteSensitivePersistence,
): string {
  return sensitive.protector.seal(
    { environment: sensitive.environment, tableId, rowId, field },
    JSON.stringify(value),
  );
}

function events(
  rows: readonly unknown[],
  schema: AppwriteIntelligenceProvenanceSchema,
  input: { readonly workspaceId: string; readonly projectId: string },
  sensitive: AppwriteSensitivePersistence,
): readonly IntelligenceProvenanceEvent[] {
  return rows.flatMap((candidate) => {
    if (
      !object(candidate) ||
      typeof candidate.$id !== "string" ||
      !id.test(candidate.$id) ||
      candidate.workspaceId !== input.workspaceId ||
      candidate.projectId !== input.projectId ||
      (candidate.associationKind !== "theme" &&
        candidate.associationKind !== "relationship") ||
      !Number.isSafeInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      typeof candidate.operationIdsJson !== "string"
    )
      throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
    const value = open(
      candidate.$id,
      schema.provenanceTableId,
      "provenanceEnvelope",
      candidate.provenanceEnvelope,
      sensitive,
    );
    const operationIds: unknown = JSON.parse(candidate.operationIdsJson);
    if (
      !Array.isArray(value) ||
      !Array.isArray(operationIds) ||
      operationIds.some((operationId) => typeof operationId !== "string") ||
      value.length !== operationIds.length
    )
      throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
    return value as readonly IntelligenceProvenanceEvent[];
  });
}

function target(
  event: IntelligenceProvenanceEvent,
): IntelligenceAssociationTarget | undefined {
  return event.type === "association_removed" ? undefined : event.target;
}

function exactFeedback(
  value: unknown,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  },
): Readonly<Record<string, unknown>> | undefined {
  return object(value) &&
    value.$id === input.feedbackId &&
    value.workspaceId === input.workspaceId &&
    value.projectId === input.projectId &&
    (value.deletedAt === undefined || value.deletedAt === null)
    ? value
    : undefined;
}

function sourceVersion(
  feedback: Readonly<Record<string, unknown>>,
  schema: AppwriteIntelligenceProvenanceSchema,
  sensitive: AppwriteSensitivePersistence,
): number {
  const revisions = open(
    feedback.$id as string,
    schema.feedbackTableId,
    "sourceRevisionsJson",
    feedback.sourceRevisionsJson,
    sensitive,
  );
  if (!Array.isArray(revisions) || revisions.length > 10_000)
    throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
  return revisions.length + 1;
}

function domainCommand(
  command: TrustedIntelligenceProvenanceCommand,
  version: number | undefined,
  scope: { readonly workspaceId: string; readonly projectId: string },
): IntelligenceProvenanceCommand {
  if (command.kind === "record_theme" || command.kind === "record_relationship") {
    /* v8 ignore next -- record commands always derive a source version first. */
    if (version === undefined)
      throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
    return {
      type: "record_association",
      operationId: command.operationId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      feedbackId: command.feedbackId,
      sourceVersion: version,
      target:
        command.kind === "record_theme"
          ? { kind: "theme", label: command.label }
          : {
              kind: "relationship",
              relatedFeedbackId: command.relatedFeedbackId,
              relationType: command.relationType,
            },
    };
  }
  if (command.kind === "remove_association")
    return {
      type: "remove_association",
      operationId: command.operationId,
      associationId: command.associationId,
      expectedRevision: command.expectedRevision,
    };
  return {
    type: "correct_association",
    operationId: command.operationId,
    associationId: command.associationId,
    expectedRevision: command.expectedRevision,
    target:
      command.kind === "correct_theme"
        ? { kind: "theme", label: command.label }
        : {
            kind: "relationship",
            relatedFeedbackId: command.relatedFeedbackId,
            relationType: command.relationType,
          },
  };
}

export function createAppwriteIntelligenceProvenanceStore(
  tables: AppwriteIntelligenceProvenanceTables,
  schema: AppwriteIntelligenceProvenanceSchema,
  queries: AppwriteIntelligenceProvenanceQueries,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwriteIntelligenceProvenanceDependencies,
): IntelligenceProvenanceStore {
  if (
    [schema.databaseId, schema.feedbackTableId, schema.provenanceTableId].some(
      (value) => !id.test(value),
    ) ||
    new Set([schema.feedbackTableId, schema.provenanceTableId]).size !== 2
  )
    throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_SCHEMA_INVALID");
  return {
    async execute(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        if (
          !id.test(input.workspaceId) ||
          !id.test(input.projectId) ||
          !id.test(input.actorId)
        )
          return { status: "invalid" };
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!id.test(transaction.$id))
          throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
        transactionId = transaction.$id;
        const listed = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.provenanceTableId,
          queries: [
            queries.equal("workspaceId", [input.workspaceId]),
            queries.equal("projectId", [input.projectId]),
            queries.limit(5_000),
          ],
          total: false,
          ttl: 0,
          transactionId,
        });
        const history = events(listed.rows, schema, input, sensitive);
        const projections = projectIntelligenceAssociations(history);
        const trustedCommand = input.command;
        const existing =
          "associationId" in trustedCommand
            ? projections.find(
                ({ associationId }) => associationId === trustedCommand.associationId,
              )
            : undefined;
        if ("associationId" in trustedCommand && !existing) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "denied" };
        }
        const feedbackId =
          "feedbackId" in trustedCommand
            ? trustedCommand.feedbackId
            : existing?.feedbackId;
        /* v8 ignore next -- association commands above require an existing projection. */
        if (feedbackId === undefined)
          throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
        let feedback: Readonly<Record<string, unknown>>;
        try {
          const row = await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: feedbackId,
            transactionId,
          });
          const exact = exactFeedback(row, { ...input, feedbackId });
          if (!exact) throw new Error("denied");
          feedback = exact;
        } catch (error: unknown) {
          if (
            !absent(error) &&
            (!(error instanceof Error) || error.message !== "denied")
          )
            throw error;
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "denied" };
        }
        const requestedTarget =
          input.command.kind === "record_relationship" ||
          input.command.kind === "correct_relationship"
            ? input.command.relatedFeedbackId
            : undefined;
        if (requestedTarget !== undefined) {
          try {
            const related = await tables.getRow({
              databaseId: schema.databaseId,
              tableId: schema.feedbackTableId,
              rowId: requestedTarget,
              transactionId,
            });
            if (!exactFeedback(related, { ...input, feedbackId: requestedTarget }))
              throw new Error("denied");
          } catch (error: unknown) {
            if (
              !absent(error) &&
              (!(error instanceof Error) || error.message !== "denied")
            )
              throw error;
            await tables.updateTransaction({ transactionId, rollback: true });
            closed = true;
            return { status: "denied" };
          }
        }
        const internal = domainCommand(
          input.command,
          "feedbackId" in input.command
            ? sourceVersion(feedback, schema, sensitive)
            : undefined,
          input,
        );
        const decision = decideIntelligenceProvenance(history, internal, {
          createAssociationId: dependencies.createAssociationId,
          createEventId: dependencies.createEventId,
          actorId: input.actorId,
          now: dependencies.now,
        });
        if (!("event" in decision)) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: decision.status };
        }
        if (decision.status === "replayed") {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return {
            status: "replayed",
            associationId: decision.event.associationId,
            eventId: decision.event.eventId,
            revision: decision.event.revision,
          };
        }
        const event = decision.event;
        const association = projectIntelligenceAssociations([...history, event]).find(
          ({ associationId }) => associationId === event.associationId,
        );
        /* v8 ignore next -- an accepted domain event always projects its association. */
        if (!association)
          throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
        const currentTarget = target(event) ?? association.target;
        const rowData = {
          workspaceId: association.workspaceId,
          projectId: association.projectId,
          themeId: association.associationId,
          feedbackId: association.feedbackId,
          relationType:
            currentTarget.kind === "theme" ? "theme" : currentTarget.relationType,
          sourceVersion: association.sourceVersion,
          actorId: association.createdBy,
          createdAt: association.createdAt,
          associationKind: currentTarget.kind,
          targetEnvelope: seal(
            association.associationId,
            schema.provenanceTableId,
            "targetEnvelope",
            currentTarget,
            sensitive,
          ),
          ...(currentTarget.kind === "relationship"
            ? { relatedFeedbackId: currentTarget.relatedFeedbackId }
            : { relatedFeedbackId: null }),
          provenanceEnvelope: seal(
            association.associationId,
            schema.provenanceTableId,
            "provenanceEnvelope",
            association.provenance,
            sensitive,
          ),
          revision: association.revision,
          updatedByActorId: association.updatedBy,
          updatedAt: association.updatedAt,
          operationIdsJson: JSON.stringify(
            association.provenance.map(({ operationId }) => operationId),
          ),
          ...(association.removedAt ? { removedAt: association.removedAt } : {}),
        };
        const persisted =
          event.type === "association_recorded"
            ? await tables.createRow({
                databaseId: schema.databaseId,
                tableId: schema.provenanceTableId,
                rowId: association.associationId,
                data: rowData,
                permissions: [],
                transactionId,
              })
            : await tables.updateRow({
                databaseId: schema.databaseId,
                tableId: schema.provenanceTableId,
                rowId: association.associationId,
                data: rowData,
                transactionId,
              });
        if (!object(persisted) || persisted.$id !== association.associationId)
          throw new Error("APPWRITE_INTELLIGENCE_PROVENANCE_UNAVAILABLE");
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return {
          status: "applied",
          associationId: association.associationId,
          eventId: event.eventId,
          revision: event.revision,
        };
      } catch {
        if (transactionId !== undefined && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // Preserve the stable retryable outcome.
          }
        }
        return { status: "retryable" };
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is covered by the deployed verifier */
export function createNodeAppwriteIntelligenceProvenanceStore(
  tables: TablesDB,
  schema: AppwriteIntelligenceProvenanceSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwriteIntelligenceProvenanceDependencies,
): IntelligenceProvenanceStore {
  return createAppwriteIntelligenceProvenanceStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      getRow: (input) => tables.getRow(input),
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    nodeQueries,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */
