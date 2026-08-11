import { Query, type TablesDB } from "node-appwrite";

import {
  validateFeedbackSource,
  type AccessGrant,
  type DeletionRequest,
  type FeedbackLifecycleState,
  type FeedbackSource,
  type ReporterAttachment,
  type ReporterFeedbackRecord,
  type ReporterHistoryEntry,
  type ReporterMessage,
  type SourceRevision,
} from "@y7-feedback/domain";

import type { AccountlessAccessRepository } from "./accountless-access";

export interface AppwriteAccountlessSchema {
  readonly databaseId: string;
  readonly accessGrantsTableId: string;
  readonly feedbackTableId: string;
}

export interface AppwriteAccountlessTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
}

export interface AppwriteAccountlessQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly limit: (limit: number) => string;
}

const defaultQueries: AppwriteAccountlessQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const lifecycleStates = new Set<FeedbackLifecycleState>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);

function invalid(): never {
  throw new Error("APPWRITE_ACCOUNTLESS_ROW_INVALID");
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: unknown, maximum = 1_000): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) return invalid();
  return normalized;
}

function optional(value: unknown, maximum = 1_000): string | null {
  if (value === null) return null;
  return required(value, maximum);
}

function optionalSource(value: unknown): string | undefined {
  return value === undefined ? undefined : required(value, 5_000);
}

function feedbackSource(value: unknown): FeedbackSource {
  if (!isObject(value)) return invalid();
  try {
    if (value.type === "bug") {
      const expectedBehavior = optionalSource(value.expectedBehavior);
      const observedBehavior = optionalSource(value.observedBehavior);
      const reproductionSteps = optionalSource(value.reproductionSteps);
      return validateFeedbackSource({
        type: "bug",
        problem: required(value.problem, 5_000),
        ...(expectedBehavior === undefined ? {} : { expectedBehavior }),
        ...(observedBehavior === undefined ? {} : { observedBehavior }),
        ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
      });
    }
    if (value.type === "suggestion") {
      const usageContext = optionalSource(value.usageContext);
      return validateFeedbackSource({
        type: "suggestion",
        proposal: required(value.proposal, 5_000),
        rationale: required(value.rationale, 5_000),
        ...(usageContext === undefined ? {} : { usageContext }),
      });
    }
    if (value.type === "review") {
      return validateFeedbackSource({
        type: "review",
        experience: required(value.experience, 5_000),
        appreciation: required(value.appreciation, 5_000),
      });
    }
    return invalid();
  } catch {
    return invalid();
  }
}

function json(value: unknown): unknown {
  try {
    return JSON.parse(required(value, 100_000)) as unknown;
  } catch {
    return invalid();
  }
}

function jsonArray(value: unknown): readonly unknown[] {
  const parsed = json(value);
  if (!Array.isArray(parsed)) return invalid();
  return parsed as readonly unknown[];
}

function audience(value: unknown): "reporter" | "workspace" {
  if (value !== "reporter" && value !== "workspace") return invalid();
  return value;
}

function history(value: unknown): readonly ReporterHistoryEntry[] {
  return jsonArray(value).map((entry) => {
    if (!isObject(entry)) return invalid();
    return {
      id: required(entry.id),
      kind: required(entry.kind),
      audience: audience(entry.audience),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
      detail: required(entry.detail, 10_000),
    };
  });
}

function messages(value: unknown): readonly ReporterMessage[] {
  return jsonArray(value).map((entry) => {
    if (!isObject(entry)) return invalid();
    return {
      id: required(entry.id),
      audience: audience(entry.audience),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
      content: required(entry.content, 10_000),
    };
  });
}

function attachments(value: unknown): readonly ReporterAttachment[] {
  return jsonArray(value).map((entry) => {
    if (!isObject(entry)) return invalid();
    return {
      id: required(entry.id),
      audience: audience(entry.audience),
      name: required(entry.name, 255),
    };
  });
}

function sourceRevisions(value: unknown): readonly SourceRevision[] {
  return jsonArray(value).map((entry) => {
    if (!isObject(entry)) return invalid();
    try {
      return {
        id: required(entry.id),
        priorSource: feedbackSource(entry.priorSource),
        source: feedbackSource(entry.source),
        actor: required(entry.actor),
        occurredAt: required(entry.occurredAt),
      };
    } catch {
      return invalid();
    }
  });
}

function deletionRequests(value: unknown): readonly DeletionRequest[] {
  return jsonArray(value).map((entry) => {
    if (!isObject(entry) || entry.status !== "received") return invalid();
    return {
      id: required(entry.id),
      status: entry.status,
      reason: required(entry.reason, 10_000),
      actor: required(entry.actor),
      occurredAt: required(entry.occurredAt),
    };
  });
}

function internalNotes(value: unknown): readonly string[] {
  return jsonArray(value).map((entry) => required(entry, 10_000));
}

function parseGrant(value: unknown, expectedReference: string): AccessGrant {
  if (!isObject(value)) return invalid();
  const rowId = required(value.$id, 36);
  const feedbackId = required(value.feedbackId, 36);
  const reference = required(value.reference, 100);
  if (rowId !== feedbackId || reference !== expectedReference) return invalid();
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    (value.status !== "active" && value.status !== "revoked")
  ) {
    return invalid();
  }
  return {
    feedbackId,
    reference,
    verifier: required(value.verifier),
    generation: value.generation,
    status: value.status,
  };
}

function parseRecord(value: unknown, grant: AccessGrant): ReporterFeedbackRecord {
  if (!isObject(value) || required(value.$id, 36) !== grant.feedbackId) {
    return invalid();
  }
  try {
    const originalSource = feedbackSource(json(value.originalSourceJson));
    const currentSource = feedbackSource(json(value.currentSourceJson));
    if (!lifecycleStates.has(value.state as FeedbackLifecycleState)) return invalid();
    return {
      feedbackId: grant.feedbackId,
      reference: grant.reference,
      originalSource,
      currentSource,
      currentState: value.state as FeedbackLifecycleState,
      history: history(value.reporterHistoryJson),
      messages: messages(value.reporterMessagesJson),
      attachments: attachments(value.reporterAttachmentsJson),
      sourceRevisions: sourceRevisions(value.sourceRevisionsJson),
      deletionRequests: deletionRequests(value.deletionRequestsJson),
      internalNotes: internalNotes(value.internalNotesJson),
      workspaceClassification: optional(value.workspaceClassification),
    };
  } catch {
    return invalid();
  }
}

function validateSchema(schema: AppwriteAccountlessSchema): void {
  const ids = [schema.databaseId, schema.accessGrantsTableId, schema.feedbackTableId];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids.slice(1)).size !== 2) {
    throw new Error("APPWRITE_ACCOUNTLESS_SCHEMA_INVALID");
  }
}

export function createAppwriteAccountlessRepository(
  tables: AppwriteAccountlessTablesPort,
  schema: AppwriteAccountlessSchema,
  queries: AppwriteAccountlessQueryPort = defaultQueries,
): AccountlessAccessRepository {
  validateSchema(schema);
  return {
    async loadByReference(reference) {
      const normalizedReference = required(reference, 100);
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.accessGrantsTableId,
        queries: [queries.equal("reference", [normalizedReference]), queries.limit(2)],
        total: false,
        ttl: 0,
      });
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new Error("APPWRITE_ACCOUNTLESS_INCONSISTENT");
      }
      const grant = parseGrant(result.rows[0], normalizedReference);
      const feedback = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: grant.feedbackId,
      });
      return { grant, record: parseRecord(feedback, grant) };
    },
    async saveGrant(grant) {
      await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.accessGrantsTableId,
        rowId: required(grant.feedbackId, 36),
        data: {
          reference: required(grant.reference, 100),
          verifier: required(grant.verifier),
          generation: grant.generation,
          status: grant.status,
        },
      });
    },
    async saveRecord(record) {
      await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: required(record.feedbackId, 36),
        data: {
          currentSourceJson: JSON.stringify(record.currentSource),
          state: record.currentState,
          reporterHistoryJson: JSON.stringify(record.history),
          reporterMessagesJson: JSON.stringify(record.messages),
          reporterAttachmentsJson: JSON.stringify(record.attachments),
          sourceRevisionsJson: JSON.stringify(record.sourceRevisions),
          deletionRequestsJson: JSON.stringify(record.deletionRequests),
        },
      });
    },
  };
}

export function createNodeAppwriteAccountlessRepository(
  tables: TablesDB,
  schema: AppwriteAccountlessSchema,
): AccountlessAccessRepository {
  return createAppwriteAccountlessRepository(
    {
      listRows: async (input) => {
        const result = await tables.listRows(input);
        return { rows: result.rows };
      },
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
    },
    schema,
  );
}
