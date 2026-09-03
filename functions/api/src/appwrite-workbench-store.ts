import { Query, type TablesDB } from "node-appwrite";

import {
  filterWorkbenchInbox,
  validateFeedbackSource,
  validateWorkspaceClassification,
  type ActorAccess,
  type FeedbackLifecycleState,
  type FeedbackSource,
  type ValidatedContext,
  type WorkbenchFilter,
  type WorkbenchInboxItem,
} from "@y7-feedback/domain";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface WorkbenchDetail {
  readonly feedbackId: string;
  readonly type: WorkbenchInboxItem["type"];
  readonly state: FeedbackLifecycleState;
  readonly acceptedAt: string;
  readonly source: FeedbackSource;
  readonly context: readonly ValidatedContext[];
  readonly attachmentNames: readonly string[];
  readonly classification: string | null;
  readonly assignedMaintainerId: string | null;
}

export class AppwriteWorkbenchError extends Error {
  readonly code: "ERR-WORK-DENIED" | "ERR-WORK-CONFLICT" | "ERR-WORK-RETRYABLE";

  constructor(code: AppwriteWorkbenchError["code"]) {
    super(code);
    this.name = "AppwriteWorkbenchError";
    this.code = code;
  }
}

export interface AppwriteWorkbenchSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
}

export interface AppwriteWorkbenchTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AppwriteWorkbenchQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface WorkbenchStore {
  list(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly filter: WorkbenchFilter;
  }): Promise<readonly WorkbenchInboxItem[]>;
  read(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  }): Promise<WorkbenchDetail>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const feedbackTypes = new Set(["bug", "suggestion", "review"]);
const states = new Set([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);
const contextNames = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const contextSources = new Set<unknown>([
  "public",
  "client_assertion",
  "system_observed",
]);
const contextTrust = new Set<unknown>(["unverified", "verified"]);
const executableContext = /<\s*script|javascript\s*:|\b(?:function|eval)\s*\(/iu;
/* v8 ignore start -- Query serialization is exercised by the deployed matrix */
const defaultQueries: AppwriteWorkbenchQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assigned(value: unknown): readonly string[] {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || !appwriteId.test(value)) {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  return [value];
}

function normalizedTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

function storedContext(value: unknown): readonly ValidatedContext[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  const result = value.map((candidate): ValidatedContext => {
    if (
      !object(candidate) ||
      typeof candidate.name !== "string" ||
      !contextNames.test(candidate.name) ||
      typeof candidate.purpose !== "string" ||
      !candidate.purpose.trim() ||
      candidate.purpose.length > 300 ||
      !contextSources.has(candidate.source) ||
      !contextTrust.has(candidate.trust) ||
      !["string", "number", "boolean"].includes(typeof candidate.value) ||
      (typeof candidate.value === "string" &&
        (candidate.value.length > 500 || executableContext.test(candidate.value))) ||
      (typeof candidate.value === "number" && !Number.isFinite(candidate.value))
    ) {
      throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
    }
    return {
      name: candidate.name,
      value: candidate.value as string | number | boolean,
      purpose: candidate.purpose,
      source: candidate.source as ValidatedContext["source"],
      trust: candidate.trust as ValidatedContext["trust"],
    };
  });
  if (new Set(result.map((candidate) => candidate.name)).size !== result.length) {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  return result;
}

function inboxItem(value: unknown): WorkbenchInboxItem {
  const acceptedAt = object(value) ? normalizedTimestamp(value.acceptedAt) : undefined;
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    typeof value.workspaceId !== "string" ||
    !appwriteId.test(value.workspaceId) ||
    typeof value.projectId !== "string" ||
    !appwriteId.test(value.projectId) ||
    !feedbackTypes.has(String(value.type)) ||
    !states.has(String(value.state)) ||
    acceptedAt === undefined
  ) {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  return {
    feedbackId: value.$id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    type: value.type as WorkbenchInboxItem["type"],
    state: value.state as FeedbackLifecycleState,
    acceptedAt,
    assignedPrincipalIds: assigned(value.assignedMaintainerId),
    deleted: value.deletedAt !== undefined && value.deletedAt !== null,
  };
}

function openJson(
  value: Readonly<Record<string, unknown>>,
  field: string,
  schema: AppwriteWorkbenchSchema,
  sensitive: AppwriteSensitivePersistence,
): unknown {
  if (typeof value.$id !== "string" || typeof value[field] !== "string") {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  try {
    return JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId: schema.feedbackTableId,
          rowId: value.$id,
          field,
        },
        value[field],
      ),
    ) as unknown;
  } catch {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
}

export function parseWorkbenchDetail(
  value: unknown,
  input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  },
  schema: AppwriteWorkbenchSchema,
  sensitive: AppwriteSensitivePersistence,
): WorkbenchDetail {
  const item = inboxItem(value);
  if (
    !object(value) ||
    item.feedbackId !== input.feedbackId ||
    item.workspaceId !== input.workspaceId ||
    item.projectId !== input.projectId ||
    item.deleted ||
    !input.actor.workspaceIds.includes(input.workspaceId) ||
    (input.actor.responsibility === "project_maintainer" &&
      !input.actor.projectIds.includes(input.projectId)) ||
    (input.actor.responsibility === "project_maintainer" &&
      !item.assignedPrincipalIds.includes(input.actor.principalId))
  ) {
    throw new AppwriteWorkbenchError("ERR-WORK-DENIED");
  }
  const rawSource = openJson(value, "currentSourceJson", schema, sensitive);
  const rawContext = openJson(value, "contextJson", schema, sensitive);
  const rawAttachments = openJson(value, "attachmentNamesJson", schema, sensitive);
  if (
    !object(rawSource) ||
    !Array.isArray(rawContext) ||
    !Array.isArray(rawAttachments) ||
    rawAttachments.length > 5 ||
    rawAttachments.some(
      (name) => typeof name !== "string" || !name.trim() || name.length > 255,
    ) ||
    (value.workspaceClassification !== null &&
      value.workspaceClassification !== undefined &&
      typeof value.workspaceClassification !== "string")
  ) {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  let source: FeedbackSource;
  let context: readonly ValidatedContext[];
  let classification: string | null;
  try {
    source = validateFeedbackSource(rawSource as unknown as FeedbackSource);
    context = storedContext(rawContext);
    classification =
      typeof value.workspaceClassification === "string"
        ? validateWorkspaceClassification(value.workspaceClassification)
        : null;
  } catch {
    throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
  }
  return {
    feedbackId: item.feedbackId,
    type: item.type,
    state: item.state,
    acceptedAt: item.acceptedAt,
    source,
    context,
    attachmentNames: rawAttachments as readonly string[],
    classification,
    assignedMaintainerId: item.assignedPrincipalIds[0] ?? null,
  };
}

export function createAppwriteWorkbenchStore(
  tables: AppwriteWorkbenchTablesPort,
  schema: AppwriteWorkbenchSchema,
  queries: AppwriteWorkbenchQueryPort,
  sensitive: AppwriteSensitivePersistence,
): WorkbenchStore {
  if (!appwriteId.test(schema.databaseId) || !appwriteId.test(schema.feedbackTableId)) {
    throw new Error("APPWRITE_WORKBENCH_SCHEMA_INVALID");
  }
  return {
    async list(input) {
      try {
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          queries: [
            queries.equal("workspaceId", [input.workspaceId]),
            queries.equal("projectId", [input.projectId]),
            queries.limit(100),
          ],
          total: false,
          ttl: 0,
        });
        return filterWorkbenchInbox(
          result.rows.map(inboxItem),
          input.actor,
          input.workspaceId,
          input.projectId,
          input.filter,
        );
      } catch (error: unknown) {
        if (error instanceof AppwriteWorkbenchError) throw error;
        throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
      }
    },
    async read(input) {
      try {
        return parseWorkbenchDetail(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: input.feedbackId,
          }),
          input,
          schema,
          sensitive,
        );
      } catch (error: unknown) {
        if (error instanceof AppwriteWorkbenchError) throw error;
        throw new AppwriteWorkbenchError("ERR-WORK-RETRYABLE");
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is exercised by the deployed Workbench matrix */
export function createNodeAppwriteWorkbenchStore(
  tables: TablesDB,
  schema: AppwriteWorkbenchSchema,
  sensitive: AppwriteSensitivePersistence,
): WorkbenchStore {
  return createAppwriteWorkbenchStore(
    {
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
      getRow: (input) => tables.getRow(input),
    },
    schema,
    defaultQueries,
    sensitive,
  );
}
/* v8 ignore stop */
