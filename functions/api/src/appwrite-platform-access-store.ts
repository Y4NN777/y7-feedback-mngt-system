import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";
import {
  approveExceptionalAccess,
  denyExceptionalAccess,
  requestExceptionalAccess,
  reviewBreakGlass,
  revokeExceptionalAccess,
  expireExceptionalAccess,
  useExceptionalAccess as executeExceptionalAccess,
  type ExceptionalAccessAuditEvent,
  type ExceptionalAccessDecision,
  type ExceptionalAccessGrant,
} from "@y7-feedback/domain";

import type { PlatformAccessCommand, PlatformAccessStore } from "./platform-access.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwritePlatformAccessSchema {
  readonly databaseId: string;
  readonly grantsTableId: string;
  readonly auditTableId: string;
}

export interface AppwritePlatformAccessTables {
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
    readonly total: false;
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
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwritePlatformAccessQueries {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly lessThanEqual: (attribute: string, value: string) => string;
  readonly limit: (value: number) => string;
}

export interface PlatformAccessExpiryWorker {
  runOnce(): Promise<{
    readonly status: "completed";
    readonly inspected: number;
    readonly expired: number;
  }>;
}

export interface AppwritePlatformAccessDependencies {
  readonly now: () => string;
  readonly createAuditId: (grantId: string, sequence: number) => string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const states = new Set([
  "requested",
  "denied",
  "active",
  "revoked",
  "expired",
  "review_required",
  "reviewed",
]);
const actions = new Set([
  "feedback.read",
  "attachment.read",
  "message.read",
  "internal_note.read",
]);

/* v8 ignore start -- Query serialization is covered by deployed verification. */
const nodeQueries: AppwritePlatformAccessQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  lessThanEqual: (attribute, value) => Query.lessThanEqual(attribute, value),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function rollback(
  tables: AppwritePlatformAccessTables,
  transactionId: string,
): Promise<void> {
  try {
    await tables.updateTransaction({ transactionId, rollback: true });
  } catch {
    // Appwrite expires abandoned transactions.
  }
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

function optionalString(row: Readonly<Record<string, unknown>>, key: string) {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("PLATFORM_GRANT_UNAVAILABLE");
  return value;
}

function parseGrant(
  row: unknown,
  schema: AppwritePlatformAccessSchema,
  sensitive: AppwriteSensitivePersistence,
): { readonly grant: ExceptionalAccessGrant; readonly auditSequence: number } {
  if (
    !object(row) ||
    typeof row.$id !== "string" ||
    typeof row.requesterId !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.state !== "string" ||
    !states.has(row.state) ||
    typeof row.reasonCode !== "string" ||
    typeof row.breakGlass !== "boolean" ||
    !Number.isSafeInteger(row.useCount) ||
    !Number.isSafeInteger(row.revision) ||
    !Number.isSafeInteger(row.auditSequence) ||
    Number(row.useCount) < 0 ||
    Number(row.revision) < 0 ||
    Number(row.auditSequence) < 1 ||
    typeof row.justificationEnvelope !== "string" ||
    (row.incidentSeverity !== "ordinary" && row.incidentSeverity !== "critical") ||
    typeof row.actionsJson !== "string" ||
    typeof row.requestedAt !== "string"
  )
    throw new Error("PLATFORM_GRANT_UNAVAILABLE");
  let parsedActions: unknown;
  let justification: string;
  try {
    parsedActions = JSON.parse(row.actionsJson);
    justification = sensitive.protector.open(
      {
        environment: sensitive.environment,
        tableId: schema.grantsTableId,
        rowId: row.$id,
        field: "justificationEnvelope",
      },
      row.justificationEnvelope,
    );
  } catch {
    throw new Error("PLATFORM_GRANT_UNAVAILABLE");
  }
  if (
    !Array.isArray(parsedActions) ||
    parsedActions.length === 0 ||
    parsedActions.some((value) => typeof value !== "string" || !actions.has(value))
  )
    throw new Error("PLATFORM_GRANT_UNAVAILABLE");
  const projectId = optionalString(row, "projectId");
  const feedbackId = optionalString(row, "feedbackId");
  const approverId = optionalString(row, "approverId");
  const approvedAt = optionalString(row, "approvedAt");
  const expiresAt = optionalString(row, "expiresAt");
  const expiredAt = optionalString(row, "expiredAt");
  const revokedAt = optionalString(row, "revokedAt");
  const reviewedAt = optionalString(row, "reviewedAt");
  return {
    grant: {
      id: row.$id,
      revision: Number(row.revision),
      requesterId: row.requesterId,
      ...(approverId ? { approverId } : {}),
      scope: {
        workspaceId: row.workspaceId,
        ...(projectId ? { projectId } : {}),
        ...(feedbackId ? { feedbackId } : {}),
        actions: parsedActions as ExceptionalAccessGrant["scope"]["actions"],
      },
      reasonCode: row.reasonCode,
      justification,
      incidentSeverity: row.incidentSeverity,
      breakGlass: row.breakGlass,
      state: row.state as ExceptionalAccessGrant["state"],
      useCount: Number(row.useCount),
      requestedAt: row.requestedAt,
      ...(approvedAt ? { approvedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(expiredAt ? { expiredAt } : {}),
      ...(revokedAt ? { revokedAt } : {}),
      ...(reviewedAt ? { reviewedAt } : {}),
    },
    auditSequence: Number(row.auditSequence),
  };
}

function grantData(
  grant: ExceptionalAccessGrant,
  auditSequence: number,
  schema: AppwritePlatformAccessSchema,
  sensitive: AppwriteSensitivePersistence,
) {
  return {
    requesterId: grant.requesterId,
    approverId: grant.approverId ?? null,
    workspaceId: grant.scope.workspaceId,
    projectId: grant.scope.projectId ?? null,
    feedbackId: grant.scope.feedbackId ?? null,
    state: grant.state,
    reasonCode: grant.reasonCode,
    breakGlass: grant.breakGlass,
    useCount: grant.useCount,
    revision: grant.revision,
    auditSequence,
    justificationEnvelope: sensitive.protector.seal(
      {
        environment: sensitive.environment,
        tableId: schema.grantsTableId,
        rowId: grant.id,
        field: "justificationEnvelope",
      },
      grant.justification,
    ),
    incidentSeverity: grant.incidentSeverity,
    actionsJson: JSON.stringify(grant.scope.actions),
    requestedAt: grant.requestedAt,
    approvedAt: grant.approvedAt ?? null,
    expiresAt: grant.expiresAt ?? null,
    expiredAt: grant.expiredAt ?? null,
    revokedAt: grant.revokedAt ?? null,
    reviewedAt: grant.reviewedAt ?? null,
  };
}

function scopeDigest(event: ExceptionalAccessAuditEvent): string {
  return createHash("sha256").update(JSON.stringify(event.scope)).digest("hex");
}

function decide(
  grant: ExceptionalAccessGrant,
  actorId: string,
  freshMfa: boolean,
  command: Exclude<PlatformAccessCommand, { readonly kind: "request" }>,
  now: string,
): ExceptionalAccessDecision {
  switch (command.kind) {
    case "approve":
      return approveExceptionalAccess(grant, {
        approverId: actorId,
        freshMfa,
        expectedRevision: command.expectedRevision,
        now,
        expiresAt: command.expiresAt,
      });
    case "deny":
      return denyExceptionalAccess(grant, {
        approverId: actorId,
        expectedRevision: command.expectedRevision,
        now,
      });
    case "use":
      return executeExceptionalAccess(grant, {
        operatorId: actorId,
        expectedRevision: command.expectedRevision,
        workspaceId: command.workspaceId,
        ...(command.projectId ? { projectId: command.projectId } : {}),
        ...(command.feedbackId ? { feedbackId: command.feedbackId } : {}),
        action: command.action,
        now,
      });
    case "revoke":
      return revokeExceptionalAccess(grant, {
        actorId,
        expectedRevision: command.expectedRevision,
        now,
      });
    case "review":
      return reviewBreakGlass(grant, {
        reviewerId: actorId,
        expectedRevision: command.expectedRevision,
        now,
      });
  }
}

export function createAppwritePlatformAccessStore(
  tables: AppwritePlatformAccessTables,
  schema: AppwritePlatformAccessSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePlatformAccessDependencies,
): PlatformAccessStore {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.grantsTableId) ||
    !appwriteId.test(schema.auditTableId) ||
    new Set([schema.databaseId, schema.grantsTableId, schema.auditTableId]).size !== 3
  )
    throw new Error("PLATFORM_ACCESS_SCHEMA_INVALID");

  return {
    async execute(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) throw new Error("invalid transaction");
        transactionId = transaction.$id;
        const now = dependencies.now();
        let existing: unknown;
        try {
          existing = await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.grantsTableId,
            rowId: input.command.grantId,
            transactionId,
          });
        } catch (error) {
          if (!absent(error)) throw error;
        }

        let decision: ExceptionalAccessDecision;
        let previousAuditSequence = 0;
        if (input.command.kind === "request") {
          if (existing !== undefined) {
            const current = parseGrant(existing, schema, sensitive).grant;
            await tables.updateTransaction({ transactionId, rollback: true });
            closed = true;
            const same =
              current.requesterId === input.actorId &&
              current.scope.workspaceId === input.command.workspaceId &&
              current.scope.projectId === input.command.projectId &&
              current.scope.feedbackId === input.command.feedbackId &&
              JSON.stringify(current.scope.actions) ===
                JSON.stringify(input.command.actions) &&
              current.reasonCode === input.command.reasonCode &&
              current.justification === input.command.justification.trim() &&
              current.incidentSeverity === input.command.incidentSeverity &&
              current.breakGlass === input.command.breakGlass;
            return same
              ? {
                  status: "replayed",
                  grantId: current.id,
                  state: current.state,
                  revision: current.revision,
                }
              : { status: "conflict" };
          }
          decision = requestExceptionalAccess({
            id: input.command.grantId,
            requesterId: input.actorId,
            scope: {
              workspaceId: input.command.workspaceId,
              ...(input.command.projectId
                ? { projectId: input.command.projectId }
                : {}),
              ...(input.command.feedbackId
                ? { feedbackId: input.command.feedbackId }
                : {}),
              actions: input.command.actions,
            },
            reasonCode: input.command.reasonCode,
            justification: input.command.justification,
            incidentSeverity: input.command.incidentSeverity,
            breakGlass: input.command.breakGlass,
            now,
          });
        } else {
          if (existing === undefined) {
            await tables.updateTransaction({ transactionId, rollback: true });
            closed = true;
            return { status: "denied" };
          }
          const parsed = parseGrant(existing, schema, sensitive);
          previousAuditSequence = parsed.auditSequence;
          decision = decide(
            parsed.grant,
            input.actorId,
            input.freshMfa,
            input.command,
            now,
          );
        }

        if (decision.status !== "ok" && decision.audit === undefined) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: decision.status };
        }
        const audit = decision.audit;
        /* v8 ignore next -- the domain union requires audit for every ok decision. */
        if (!audit) throw new Error("missing audit");
        const auditSequence = previousAuditSequence + 1;
        const auditId = dependencies.createAuditId(audit.grantId, auditSequence);
        if (!appwriteId.test(auditId)) throw new Error("invalid audit id");

        if (decision.status === "ok") {
          const data = grantData(decision.grant, auditSequence, schema, sensitive);
          if (existing === undefined)
            await tables.createRow({
              databaseId: schema.databaseId,
              tableId: schema.grantsTableId,
              rowId: decision.grant.id,
              data,
              permissions: [],
              transactionId,
            });
          else
            await tables.updateRow({
              databaseId: schema.databaseId,
              tableId: schema.grantsTableId,
              rowId: decision.grant.id,
              data,
              transactionId,
            });
        } else {
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.grantsTableId,
            rowId: audit.grantId,
            data: { auditSequence },
            transactionId,
          });
        }
        await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.auditTableId,
          rowId: auditId,
          permissions: [],
          transactionId,
          data: {
            grantId: audit.grantId,
            sequence: auditSequence,
            eventType: audit.type,
            actorId: audit.actorId,
            scopeDigest: scopeDigest(audit),
            reasonCode: audit.reasonCode,
            occurredAt: audit.occurredAt,
          },
        });
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return decision.status === "ok"
          ? {
              status: "applied",
              grantId: decision.grant.id,
              state: decision.grant.state,
              revision: decision.grant.revision,
            }
          : { status: decision.status };
      } catch {
        if (transactionId && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // The transaction expires; preserve the stable retryable outcome.
          }
        }
        return { status: "retryable" };
      }
    },
  };
}

export function createAppwritePlatformAccessExpiryWorker(
  tables: AppwritePlatformAccessTables,
  schema: AppwritePlatformAccessSchema,
  queries: AppwritePlatformAccessQueries,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePlatformAccessDependencies,
  batchSize = 25,
): PlatformAccessExpiryWorker {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error("PLATFORM_EXPIRY_BATCH_INVALID");
  return {
    async runOnce() {
      const now = dependencies.now();
      const listed = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.grantsTableId,
        queries: [
          queries.equal("state", ["active"]),
          queries.lessThanEqual("expiresAt", now),
          queries.limit(batchSize),
        ],
        total: false,
      });
      let expired = 0;
      for (const candidate of listed.rows) {
        if (!object(candidate) || typeof candidate.$id !== "string")
          throw new Error("PLATFORM_EXPIRY_UNAVAILABLE");
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id))
          throw new Error("PLATFORM_EXPIRY_UNAVAILABLE");
        try {
          const current = parseGrant(
            await tables.getRow({
              databaseId: schema.databaseId,
              tableId: schema.grantsTableId,
              rowId: candidate.$id,
              transactionId: transaction.$id,
            }),
            schema,
            sensitive,
          );
          const decision = expireExceptionalAccess(current.grant, {
            actorId: "platform_expiry_worker",
            expectedRevision: current.grant.revision,
            now,
          });
          if (decision.status !== "ok") {
            await tables.updateTransaction({
              transactionId: transaction.$id,
              rollback: true,
            });
            continue;
          }
          const sequence = current.auditSequence + 1;
          const auditId = dependencies.createAuditId(decision.grant.id, sequence);
          if (!appwriteId.test(auditId)) throw new Error("invalid audit id");
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.grantsTableId,
            rowId: decision.grant.id,
            data: grantData(decision.grant, sequence, schema, sensitive),
            transactionId: transaction.$id,
          });
          await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.auditTableId,
            rowId: auditId,
            permissions: [],
            transactionId: transaction.$id,
            data: {
              grantId: decision.audit.grantId,
              sequence,
              eventType: decision.audit.type,
              actorId: decision.audit.actorId,
              scopeDigest: scopeDigest(decision.audit),
              reasonCode: decision.audit.reasonCode,
              occurredAt: decision.audit.occurredAt,
            },
          });
          await tables.updateTransaction({
            transactionId: transaction.$id,
            commit: true,
          });
          expired += 1;
        } catch (error) {
          await rollback(tables, transaction.$id);
          throw error;
        }
      }
      return { status: "completed", inspected: listed.rows.length, expired };
    },
  };
}

/* v8 ignore start -- thin SDK mapping is covered by deployed verification. */
export function createNodeAppwritePlatformAccessStore(
  tables: TablesDB,
  schema: AppwritePlatformAccessSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePlatformAccessDependencies,
): PlatformAccessStore {
  return createAppwritePlatformAccessStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      createRow: (input) => tables.createRow({ ...input, permissions: [] }),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */

/* v8 ignore start -- thin SDK mapping is covered by deployed verification. */
export function createNodeAppwritePlatformAccessExpiryWorker(
  tables: TablesDB,
  schema: AppwritePlatformAccessSchema,
  sensitive: AppwriteSensitivePersistence,
  dependencies: AppwritePlatformAccessDependencies,
): PlatformAccessExpiryWorker {
  const port: AppwritePlatformAccessTables = {
    createTransaction: (input) => tables.createTransaction(input),
    getRow: (input) => tables.getRow(input),
    listRows: async (input) => ({
      rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
    }),
    createRow: (input) => tables.createRow({ ...input, permissions: [] }),
    updateRow: (input) => tables.updateRow(input),
    updateTransaction: (input) => tables.updateTransaction(input),
  };
  return createAppwritePlatformAccessExpiryWorker(
    port,
    schema,
    nodeQueries,
    sensitive,
    dependencies,
  );
}
/* v8 ignore stop */
