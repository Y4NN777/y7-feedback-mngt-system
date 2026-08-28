import { createHash } from "node:crypto";
import { Query, type TablesDB } from "node-appwrite";

import {
  ProjectAdministrationStateError,
  planProjectAdministrationMutation,
  validateProjectFeedbackConfig,
  type ContextDeclaration,
  type FeedbackType,
  type ProjectAdministrationCommand,
  type ProjectAdministrationMutation,
  type ProjectAdministrationState,
} from "@y7-feedback/domain";

type CreateProjectCommand = Extract<
  ProjectAdministrationCommand,
  { kind: "create_project" }
>;
type MutationCommand = Exclude<
  ProjectAdministrationCommand,
  { kind: "create_project" }
>;

export class AppwriteProjectAdministrationError extends Error {
  readonly code:
    | "ERR-ADMIN-IDEMPOTENCY-CONFLICT"
    | "ERR-ADMIN-DENIED"
    | "ERR-ADMIN-MUTATION-INVALID"
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
  readonly projectAssignmentsTableId: string;
  readonly workspaceMembershipsTableId: string;
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

export interface AppwriteProjectAdministrationQueryPort {
  equal(attribute: string, values: readonly (string | boolean)[]): string;
  limit(limit: number): string;
}

export interface CreateProjectAdministrationInput {
  readonly command: CreateProjectCommand;
  readonly actorId: string;
  readonly auditId: string;
  readonly occurredAt: string;
  readonly payloadDigest: string;
}

export interface MutateProjectAdministrationInput {
  readonly command: MutationCommand;
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

export type MutateProjectAdministrationResult = {
  readonly status: "applied" | "replayed";
  readonly projectId: string;
  readonly action: MutationCommand["kind"];
  readonly slug?: string;
  readonly active?: boolean;
  readonly maintainerId?: string;
};

export interface AppwriteProjectAdministrationStore {
  create(
    input: CreateProjectAdministrationInput,
  ): Promise<CreateProjectAdministrationResult>;
  mutate(
    input: MutateProjectAdministrationInput,
  ): Promise<MutateProjectAdministrationResult>;
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
    .slice(0, 36 - prefix.length);
  return `${prefix}${digest}`;
}

function validateSchema(schema: AppwriteProjectAdministrationSchema): void {
  const ids = [
    schema.databaseId,
    schema.projectsTableId,
    schema.projectSlugsTableId,
    schema.projectAssignmentsTableId,
    schema.workspaceMembershipsTableId,
    schema.administrationAuditTableId,
    schema.administrationIdempotencyTableId,
  ];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_PROJECT_ADMINISTRATION_SCHEMA_INVALID");
  }
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("APPWRITE_PROJECT_INVALID");
  return JSON.parse(value) as unknown;
}

function projectState(
  value: unknown,
  command: MutationCommand,
): ProjectAdministrationState {
  if (
    !isObject(value) ||
    value.$id !== command.projectId ||
    typeof value.workspaceId !== "string" ||
    typeof value.slug !== "string" ||
    typeof value.active !== "boolean" ||
    typeof value.reporterPurposeFr !== "string" ||
    typeof value.reporterPurposeEn !== "string"
  ) {
    throw new Error("APPWRITE_PROJECT_INVALID");
  }
  if (value.workspaceId !== command.workspaceId) {
    throw new AppwriteProjectAdministrationError("ERR-ADMIN-DENIED");
  }
  const enabledTypes = parsedJson(value.enabledTypesJson);
  const contextDeclarations = parsedJson(value.contextDeclarationsJson);
  if (!Array.isArray(enabledTypes) || !Array.isArray(contextDeclarations)) {
    throw new Error("APPWRITE_PROJECT_INVALID");
  }
  const configuration = validateProjectFeedbackConfig({
    projectId: command.projectId,
    workspaceId: command.workspaceId,
    active: value.active,
    enabledTypes: enabledTypes as readonly FeedbackType[],
    contextDeclarations: contextDeclarations as readonly ContextDeclaration[],
  });
  if (
    !value.reporterPurposeFr.trim() ||
    value.reporterPurposeFr.length > 300 ||
    !value.reporterPurposeEn.trim() ||
    value.reporterPurposeEn.length > 300
  ) {
    throw new Error("APPWRITE_PROJECT_INVALID");
  }
  return {
    projectId: command.projectId,
    workspaceId: command.workspaceId,
    slug: value.slug,
    active: value.active,
    enabledTypes: configuration.enabledTypes,
    contextDeclarations: configuration.contextDeclarations,
    reporterPurpose: {
      fr: value.reporterPurposeFr,
      en: value.reporterPurposeEn,
    },
  };
}

function mutationReplay(
  value: unknown,
  input: MutateProjectAdministrationInput,
): Omit<MutateProjectAdministrationResult, "status"> | "conflict" | undefined {
  if (
    !isObject(value) ||
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
    if (
      !isObject(result) ||
      result.projectId !== input.command.projectId ||
      result.action !== input.command.kind
    ) {
      return undefined;
    }
    return result as Omit<MutateProjectAdministrationResult, "status">;
  } catch {
    return undefined;
  }
}

function resultForMutation(
  command: MutationCommand,
  mutation: ProjectAdministrationMutation,
): Omit<MutateProjectAdministrationResult, "status"> {
  const base = { projectId: command.projectId, action: command.kind };
  switch (mutation.kind) {
    case "configure_project":
      return base;
    case "rename_project":
      return { ...base, slug: mutation.slug };
    case "set_project_activation":
      return { ...base, active: mutation.active };
    case "assign_maintainer":
    case "remove_maintainer":
      return { ...base, maintainerId: mutation.maintainerId };
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
    async mutate(input) {
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
          const original = mutationReplay(idempotency.rows[0], input);
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

        const rawProject = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.projectsTableId,
          rowId: input.command.projectId,
          transactionId,
        });
        const state = projectState(rawProject, input.command);
        let assignment:
          { readonly eligible: boolean; readonly active: boolean } | undefined;
        let assignmentRowId: string | undefined;
        if (
          input.command.kind === "assign_maintainer" ||
          input.command.kind === "remove_maintainer"
        ) {
          const memberships = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.workspaceMembershipsTableId,
            queries: [
              queries.equal("workspaceId", [input.command.workspaceId]),
              queries.equal("userId", [input.command.maintainerId]),
              queries.limit(2),
            ],
            total: false,
            ttl: 0,
            transactionId,
          });
          if (memberships.rows.length > 1) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
          const membership = memberships.rows[0];
          const eligible =
            memberships.rows.length === 1 &&
            isObject(membership) &&
            typeof membership.$id === "string" &&
            appwriteId.test(membership.$id) &&
            membership.workspaceId === input.command.workspaceId &&
            membership.userId === input.command.maintainerId &&
            membership.role === "project_maintainer" &&
            membership.status === "active";
          const assignments = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.projectAssignmentsTableId,
            queries: [
              queries.equal("projectId", [input.command.projectId]),
              queries.equal("userId", [input.command.maintainerId]),
              queries.limit(2),
            ],
            total: false,
            ttl: 0,
            transactionId,
          });
          if (assignments.rows.length > 1) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
          const current = assignments.rows[0];
          if (current !== undefined) {
            if (
              !isObject(current) ||
              typeof current.$id !== "string" ||
              !appwriteId.test(current.$id) ||
              current.workspaceId !== input.command.workspaceId ||
              current.projectId !== input.command.projectId ||
              current.userId !== input.command.maintainerId ||
              (current.status !== "active" && current.status !== "inactive")
            ) {
              throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
            }
            assignmentRowId = current.$id;
          }
          assignment = { eligible, active: current?.status === "active" };
        }

        let mutation: ProjectAdministrationMutation;
        try {
          mutation = planProjectAdministrationMutation(
            input.command,
            state,
            assignment,
          );
        } catch (error: unknown) {
          /* v8 ignore else -- the pure planner has no other thrown outcome */
          if (error instanceof ProjectAdministrationStateError) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-MUTATION-INVALID");
          }
          /* v8 ignore next -- the pure planner only throws its closed error type */
          throw error;
        }

        const mutationTransactionId = transactionId;
        const update = async (
          tableId: string,
          rowId: string,
          data: Readonly<Record<string, unknown>>,
        ) => {
          const row = await tables.updateRow({
            databaseId: schema.databaseId,
            tableId,
            rowId,
            data,
            transactionId: mutationTransactionId,
          });
          if (!validRowIdentity(row, rowId)) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
        };
        const create = async (
          tableId: string,
          rowId: string,
          data: Readonly<Record<string, unknown>>,
        ) => {
          const row = await tables.createRow({
            databaseId: schema.databaseId,
            tableId,
            rowId,
            data,
            permissions: [],
            transactionId: mutationTransactionId,
          });
          if (!validRowIdentity(row, rowId)) {
            throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
          }
        };

        switch (mutation.kind) {
          case "configure_project":
            await update(schema.projectsTableId, input.command.projectId, {
              enabledTypesJson: JSON.stringify(mutation.projectPatch.enabledTypes),
              contextDeclarationsJson: JSON.stringify(
                mutation.projectPatch.contextDeclarations,
              ),
              reporterPurposeFr: mutation.projectPatch.reporterPurpose.fr,
              reporterPurposeEn: mutation.projectPatch.reporterPurpose.en,
            });
            break;
          case "rename_project": {
            const reservations = await tables.listRows({
              databaseId: schema.databaseId,
              tableId: schema.projectSlugsTableId,
              queries: [queries.equal("slug", [mutation.slug]), queries.limit(1)],
              total: false,
              ttl: 0,
              transactionId,
            });
            if (reservations.rows.length !== 0) {
              throw new AppwriteProjectAdministrationError("ERR-ADMIN-SLUG-RESERVED");
            }
            const currentSlugs = await tables.listRows({
              databaseId: schema.databaseId,
              tableId: schema.projectSlugsTableId,
              queries: [
                queries.equal("projectId", [input.command.projectId]),
                queries.equal("current", [true]),
                queries.limit(2),
              ],
              total: false,
              ttl: 0,
              transactionId,
            });
            const current = currentSlugs.rows[0];
            if (
              currentSlugs.rows.length !== 1 ||
              !isObject(current) ||
              typeof current.$id !== "string" ||
              !appwriteId.test(current.$id) ||
              current.slug !== mutation.previousSlug ||
              current.workspaceId !== input.command.workspaceId ||
              current.projectId !== input.command.projectId ||
              current.current !== true
            ) {
              throw new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE");
            }
            await update(schema.projectSlugsTableId, current.$id, {
              current: false,
            });
            await update(schema.projectsTableId, input.command.projectId, {
              slug: mutation.slug,
            });
            await create(
              schema.projectSlugsTableId,
              stableRowId("slug_", input.command.workspaceId, mutation.slug),
              {
                slug: mutation.slug,
                workspaceId: input.command.workspaceId,
                projectId: input.command.projectId,
                current: true,
                claimedAt: input.occurredAt,
              },
            );
            break;
          }
          case "set_project_activation":
            await update(schema.projectsTableId, input.command.projectId, {
              active: mutation.active,
            });
            break;
          case "assign_maintainer":
          case "remove_maintainer": {
            const data = {
              workspaceId: input.command.workspaceId,
              projectId: input.command.projectId,
              userId: mutation.maintainerId,
              status: mutation.active ? "active" : "inactive",
              updatedAt: input.occurredAt,
            };
            if (assignmentRowId === undefined) {
              await create(
                schema.projectAssignmentsTableId,
                stableRowId(
                  "assignment_",
                  input.command.projectId,
                  mutation.maintainerId,
                ),
                { ...data, createdAt: input.occurredAt },
              );
            } else {
              await update(schema.projectAssignmentsTableId, assignmentRowId, data);
            }
            break;
          }
        }

        const result = resultForMutation(input.command, mutation);
        await create(schema.administrationAuditTableId, input.auditId, {
          workspaceId: input.command.workspaceId,
          projectId: input.command.projectId,
          actorId: input.actorId,
          action: input.command.kind,
          operationId: input.command.operationId,
          payloadDigest: input.payloadDigest,
          occurredAt: input.occurredAt,
        });
        await create(
          schema.administrationIdempotencyTableId,
          stableRowId("idem_", input.command.workspaceId, input.command.operationId),
          {
            workspaceId: input.command.workspaceId,
            operationId: input.command.operationId,
            payloadDigest: input.payloadDigest,
            action: input.command.kind,
            projectId: input.command.projectId,
            auditId: input.auditId,
            resultJson: JSON.stringify(result),
            createdAt: input.occurredAt,
          },
        );
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return { status: "applied", ...result };
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
      getRow: (input) => tables.getRow(input),
      createRow: (input) =>
        tables.createRow({
          ...input,
          permissions: [...input.permissions],
        }),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    defaultQueries,
  );
}
