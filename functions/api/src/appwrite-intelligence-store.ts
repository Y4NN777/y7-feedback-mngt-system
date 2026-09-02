import { Query, type TablesDB } from "node-appwrite";

import type {
  FeedbackLifecycleState,
  FeedbackType,
  IntelligenceContextValue,
  IntelligenceFeedback,
  IntelligenceReporterKind,
} from "@y7-feedback/domain";

import type { IntelligenceStore } from "./intelligence.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteIntelligenceSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly reportersTableId: string;
}

export interface AppwriteIntelligenceTables {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteIntelligenceQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const feedbackTypes = new Set<unknown>(["bug", "suggestion", "review"]);
const states = new Set<unknown>([
  "received",
  "under_review",
  "awaiting_reporter",
  "resolved",
  "closed",
]);

/* v8 ignore start -- SDK serialization is covered by the deployed verifier */
const nodeQueries: AppwriteIntelligenceQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !value.endsWith("Z"))
    throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  return new Date(parsed).toISOString();
}

function open(
  row: Readonly<Record<string, unknown>>,
  field: string,
  tableId: string,
  sensitive: AppwriteSensitivePersistence,
): unknown {
  if (typeof row.$id !== "string" || typeof row[field] !== "string")
    throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  try {
    return JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId,
          rowId: row.$id,
          field,
        },
        row[field],
      ),
    ) as unknown;
  } catch {
    throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  }
}

function reporterKind(value: unknown): IntelligenceReporterKind {
  if (!object(value) || typeof value.kind !== "string")
    throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  if (value.kind === "unidentified" || value.kind === "contact") return value.kind;
  if (value.kind === "external" || value.kind === "assertion") return "external";
  throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
}

function contexts(value: unknown): readonly IntelligenceContextValue[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
  return value.map((entry) => {
    if (
      !object(entry) ||
      typeof entry.name !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(entry.name) ||
      (typeof entry.value !== "string" &&
        typeof entry.value !== "number" &&
        typeof entry.value !== "boolean") ||
      (typeof entry.value === "number" && !Number.isFinite(entry.value)) ||
      (entry.trust !== "verified" && entry.trust !== "unverified")
    )
      throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
    return {
      name: entry.name,
      value: entry.value,
      reviewed: entry.trust === "verified",
    };
  });
}

function namedContext(
  values: readonly IntelligenceContextValue[],
  name: string,
): string | undefined {
  const value = values.find((entry) => entry.reviewed && entry.name === name)?.value;
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

export function createAppwriteIntelligenceStore(
  tables: AppwriteIntelligenceTables,
  schema: AppwriteIntelligenceSchema,
  queries: AppwriteIntelligenceQueries,
  sensitive: AppwriteSensitivePersistence,
): IntelligenceStore {
  if (
    !id.test(schema.databaseId) ||
    !id.test(schema.feedbackTableId) ||
    !id.test(schema.reportersTableId)
  )
    throw new Error("APPWRITE_INTELLIGENCE_SCHEMA_INVALID");
  return {
    async list(input) {
      if (!id.test(input.workspaceId) || !id.test(input.projectId))
        throw new Error("APPWRITE_INTELLIGENCE_SCOPE_INVALID");
      try {
        const [feedback, reporters] = await Promise.all([
          tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            queries: [
              queries.equal("workspaceId", [input.workspaceId]),
              queries.equal("projectId", [input.projectId]),
              queries.limit(5_000),
            ],
            total: false,
            ttl: 0,
          }),
          tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.reportersTableId,
            queries: [
              queries.equal("workspaceId", [input.workspaceId]),
              queries.limit(5_000),
            ],
            total: false,
            ttl: 0,
          }),
        ]);
        const reporterKinds = new Map<string, IntelligenceReporterKind>();
        for (const candidate of reporters.rows) {
          if (
            !object(candidate) ||
            typeof candidate.$id !== "string" ||
            !id.test(candidate.$id) ||
            candidate.workspaceId !== input.workspaceId
          )
            throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
          reporterKinds.set(
            candidate.$id,
            reporterKind(
              open(candidate, "attributionJson", schema.reportersTableId, sensitive),
            ),
          );
        }
        return feedback.rows.map((candidate): IntelligenceFeedback => {
          if (
            !object(candidate) ||
            typeof candidate.$id !== "string" ||
            !id.test(candidate.$id) ||
            candidate.workspaceId !== input.workspaceId ||
            candidate.projectId !== input.projectId ||
            typeof candidate.reporterId !== "string" ||
            !feedbackTypes.has(candidate.type) ||
            !states.has(candidate.state)
          )
            throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
          const kind = reporterKinds.get(candidate.reporterId);
          if (!kind) throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
          const context = contexts(
            open(candidate, "contextJson", schema.feedbackTableId, sensitive),
          );
          const version = namedContext(context, "applicationVersion");
          const place = namedContext(context, "place");
          const feature = namedContext(context, "feature");
          return {
            feedbackId: candidate.$id,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: candidate.type as FeedbackType,
            state: candidate.state as FeedbackLifecycleState,
            createdAt: timestamp(candidate.acceptedAt),
            reporterKind: kind,
            ...(version ? { version } : {}),
            ...(place ? { place } : {}),
            ...(feature ? { feature } : {}),
            context,
            ...(candidate.deletedAt === undefined || candidate.deletedAt === null
              ? {}
              : { deletedAt: timestamp(candidate.deletedAt) }),
          };
        });
      } catch {
        throw new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE");
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is covered by the deployed verifier */
export function createNodeAppwriteIntelligenceStore(
  tables: TablesDB,
  schema: AppwriteIntelligenceSchema,
  sensitive: AppwriteSensitivePersistence,
): IntelligenceStore {
  return createAppwriteIntelligenceStore(
    {
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
    },
    schema,
    nodeQueries,
    sensitive,
  );
}
/* v8 ignore stop */
