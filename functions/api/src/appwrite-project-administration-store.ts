import { createHash } from "node:crypto";
import { Query, type TablesDB } from "node-appwrite";

import type { ProjectAdministrationCommand } from "@y7-feedback/domain";

type CreateProjectCommand = Extract<
  ProjectAdministrationCommand,
  { kind: "create_project" }
>;

export class AppwriteProjectAdministrationError extends Error {
  readonly code:
    | "ERR-ADMIN-IDEMPOTENCY-CONFLICT"
    | "ERR-ADMIN-SLUG-RESERVED"
    | "ERR-ADMIN-RETRYABLE";

  constructor(code: AppwriteProjectAdministrationError["code"]) {
    super(code);
    this.name = "AppwriteProjectAdministrationError";
    this.code = code;
  }
}

export interface AppwriteProjectAdministrationSchema {
  readonly databaseId: string;
  readonly projectsTableId: string;
  readonly projectSlugsTableId: string;
  readonly administrationAuditTableId: string;
  readonly administrationIdempotencyTableId: string;
}

export interface AppwriteProjectAdministrationTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
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
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteProjectAdministrationQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(limit: number): string;
}

export interface CreateProjectAdministrationInput {
  readonly command: CreateProjectCommand;
  readonly actorId: string;
  readonly auditId: string;
  readonly occurredAt: string;
  readonly payloadDigest: string;
}

export type CreateProjectAdministrationResult = {
  readonly status: "created" | "replayed";
  readonly projectId: string;
  readonly slug: string;
};

export interface AppwriteProjectAdministrationStore {
  create(
    input: CreateProjectAdministrationInput,
  ): Promise<CreateProjectAdministrationResult>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const defaultQueries: AppwriteProjectAdministrationQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableRowId(prefix: string, ...parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 31);
  return `${prefix}${digest}`;
}

function validateSchema(schema: AppwriteProjectAdministrationSchema): void {
  const ids = [
    schema.databaseId,
    schema.projectsTableId,
    schema.projectSlugsTableId,
    schema.administrationAuditTableId,
    schema.administrationIdempotencyTableId,
  ];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_PROJECT_ADMINISTRATION_SCHEMA_INVALID");
  }
}

function validRowIdentity(value: unknown, expectedId: string): boolean {
  return isObject(value) && value.$id === expectedId;
}

function replay(
  value: unknown,
  input: CreateProjectAdministrationInput,
): Omit<CreateProjectAdministrationResult, "status"> | "conflict" | undefined {
  if (!isObject(value)) return undefined;
  if (
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.workspaceId !== input.command.workspaceId ||
    value.operationId !== input.command.operationId ||
    value.action !== input.command.kind ||
    typeof value.payloadDigest !== "string" ||
    typeof value.resultJson !== "string"
  ) {
    return undefined;
  }
  if (value.payloadDigest !== input.payloadDigest) return "conflict";
  try {
    const result: unknown = JSON.parse(value.resultJson);
    return isObject(result) &&
      result.projectId === input.command.projectId &&
      result.slug === input.command.slug
      ? { projectId: input.command.projectId, slug: input.command.slug }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createAppwriteProjectAdministrationStore(
  tables: AppwriteProjectAdministrationTablesPort,
  schema: AppwriteProjectAdministrationSchema,
  queries: AppwriteProjectAdministrationQueryPort,
): AppwriteProjectAdministrationStore {
  validateSchema(schema);

  return {
    async create(input) {
      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) {
          throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
        }
        transactionId = transaction.$id;
        const idempotency = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.administrationIdempotencyTableId,
          queries: [
            queries.equal("workspaceId", [input.command.workspaceId]),
            queries.equal("operationId", [input.command.operationId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
          transactionId,
        });
        if (idempotency.rows.length > 1) {
          throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
        }
        if (idempotency.rows.length === 1) {
          const original = replay(idempotency.rows[0], input);
          if (original === "conflict") {
            throw new AppwriteProjectAdministrationError(
              "ERR-ADMIN-IDEMPOTENCY-CONFLICT",
            );
          }
          if (original === undefined) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return { status: "replayed", ...original };
        }

        const reservations = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.projectSlugsTableId,
          queries: [queries.equal("slug", [input.command.slug]), queries.limit(1)],
          total: false,
          ttl: 0,
          transactionId,
        });
        if (reservations.rows.length !== 0) {
          throw new AppwriteProjectAdministrationError("ERR-ADMIN-SLUG-RESERVED");
        }

        const result = {
          projectId: input.command.projectId,
          slug: input.command.slug,
        };
        const rows = [
          {
            tableId: schema.projectsTableId,
            rowId: input.command.projectId,
            data: {
              workspaceId: input.command.workspaceId,
              slug: input.command.slug,
              active: true,
              enabledTypesJson: JSON.stringify(input.command.enabledTypes),
              contextDeclarationsJson: JSON.stringify(
                input.command.contextDeclarations,
              ),
              reporterPurposeFr: input.command.reporterPurpose.fr,
              reporterPurposeEn: input.command.reporterPurpose.en,
            },
          },
          {
            tableId: schema.projectSlugsTableId,
            rowId: stableRowId("slug_", input.command.workspaceId, input.command.slug),
            data: {
              slug: input.command.slug,
              workspaceId: input.command.workspaceId,
              projectId: input.command.projectId,
              current: true,
              claimedAt: input.occurredAt,
            },
          },
          {
            tableId: schema.administrationAuditTableId,
            rowId: input.auditId,
            data: {
              workspaceId: input.command.workspaceId,
              projectId: input.command.projectId,
              actorId: input.actorId,
              action: input.command.kind,
              operationId: input.command.operationId,
              payloadDigest: input.payloadDigest,
              occurredAt: input.occurredAt,
            },
          },
          {
            tableId: schema.administrationIdempotencyTableId,
            rowId: stableRowId(
              "idem_",
              input.command.workspaceId,
              input.command.operationId,
            ),
            data: {
              workspaceId: input.command.workspaceId,
              operationId: input.command.operationId,
              payloadDigest: input.payloadDigest,
              action: input.command.kind,
              projectId: input.command.projectId,
              auditId: input.auditId,
              resultJson: JSON.stringify(result),
              createdAt: input.occurredAt,
            },
          },
        ] as const;

        for (const row of rows) {
          const created = await tables.createRow({
            databaseId: schema.databaseId,
            ...row,
            permissions: [],
            transactionId,
          });
          if (!validRowIdentity(created, row.rowId)) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
        }
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return { status: "created", ...result };
      } catch (error: unknown) {
        if (transactionId !== undefined && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // Preserve the stable originating outcome.
          }
        }
        if (error instanceof AppwriteProjectAdministrationError) throw error;
        throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
      }
    },
  };
}

export function createNodeAppwriteProjectAdministrationStore(
  tables: TablesDB,
  schema: AppwriteProjectAdministrationSchema,
): AppwriteProjectAdministrationStore {
  return createAppwriteProjectAdministrationStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
      createRow: (input) =>
        tables.createRow({
          ...input,
          permissions: [...input.permissions],
        }),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    defaultQueries,
  );
}
