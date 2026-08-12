import { Query, type TablesDB } from "node-appwrite";

import {
  validateProjectFeedbackConfig,
  type ContextDeclaration,
  type FeedbackType,
  type ProjectFeedbackConfig,
} from "@y7-feedback/domain";

import type { PublicProject, PublicProjectReader } from "./public-api.js";

export interface AppwritePublicProjectSchema {
  readonly databaseId: string;
  readonly projectsTableId: string;
}

export interface AppwriteProjectTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteProjectQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly limit: (limit: number) => string;
}

const defaultQueries: AppwriteProjectQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const projectSlug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, maximum = 300): string {
  if (typeof value !== "string") throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  }
  return normalized;
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(requiredString(value, 20_000)) as unknown;
  } catch {
    throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  }
}

function enabledTypes(value: unknown): readonly FeedbackType[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  }
  return (parsed as readonly unknown[]).map((item) => {
    if (item !== "bug" && item !== "suggestion" && item !== "review") {
      throw new Error("APPWRITE_PROJECT_ROW_INVALID");
    }
    return item;
  });
}

function contextDeclarations(value: unknown): readonly ContextDeclaration[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  return parsed as readonly ContextDeclaration[];
}

function parseRow(value: unknown, expectedSlug: string): PublicProject {
  try {
    if (!isObject(value)) throw new Error("APPWRITE_PROJECT_ROW_INVALID");
    const projectId = requiredString(value.$id, 36);
    const workspaceId = requiredString(value.workspaceId, 36);
    const slug = requiredString(value.slug, 63);
    if (slug !== expectedSlug || typeof value.active !== "boolean") {
      throw new Error("APPWRITE_PROJECT_ROW_INVALID");
    }
    const feedbackConfig: ProjectFeedbackConfig = validateProjectFeedbackConfig({
      projectId,
      workspaceId,
      active: value.active,
      enabledTypes: enabledTypes(value.enabledTypesJson),
      contextDeclarations: contextDeclarations(value.contextDeclarationsJson),
    });
    return {
      slug,
      feedbackConfig,
      reporterPurpose: {
        fr: requiredString(value.reporterPurposeFr),
        en: requiredString(value.reporterPurposeEn),
      },
    };
  } catch {
    throw new Error("APPWRITE_PROJECT_ROW_INVALID");
  }
}

export function createAppwritePublicProjectReader(
  tables: AppwriteProjectTablesPort,
  schema: AppwritePublicProjectSchema,
  queries: AppwriteProjectQueryPort = defaultQueries,
): PublicProjectReader {
  if (!appwriteId.test(schema.databaseId) || !appwriteId.test(schema.projectsTableId)) {
    throw new Error("APPWRITE_PROJECT_SCHEMA_INVALID");
  }

  return {
    async findBySlug(slug) {
      if (!projectSlug.test(slug)) throw new Error("APPWRITE_PROJECT_SLUG_INVALID");
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.projectsTableId,
        queries: [queries.equal("slug", [slug]), queries.limit(2)],
        total: false,
        ttl: 0,
      });
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new Error("APPWRITE_PROJECT_ROW_INVALID");
      }
      return parseRow(result.rows[0], slug);
    },
  };
}

export function createNodeAppwritePublicProjectReader(
  tables: TablesDB,
  schema: AppwritePublicProjectSchema,
): PublicProjectReader {
  return createAppwritePublicProjectReader(
    {
      listRows: async (input) => {
        const result = await tables.listRows(input);
        return { rows: result.rows };
      },
    },
    schema,
  );
}
