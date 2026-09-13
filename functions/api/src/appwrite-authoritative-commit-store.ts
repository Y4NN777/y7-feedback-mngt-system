import {
  planAuthoritativeCommit,
  resolveAuthoritativeCommitReplay,
  type AuthoritativeCommit,
} from "@y7-feedback/domain";

export interface AppwriteAuthoritativeCommitSchema {
  readonly databaseId: string;
  readonly authoritativeCommitsTableId: string;
}

export interface AppwriteAuthoritativeCommitTablesPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }): Promise<unknown>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AuthoritativeCommitStore {
  accept(commit: AuthoritativeCommit): Promise<{
    readonly status: "applied" | "replayed";
    readonly commit: AuthoritativeCommit;
  }>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conflict(error: unknown): boolean {
  return object(error) && error.code === 409;
}

function canonicalRow(
  value: unknown,
  expected: AuthoritativeCommit,
): AuthoritativeCommit | null {
  if (!object(value) || value.$id !== expected.id) return null;
  let candidate: AuthoritativeCommit;
  try {
    const acceptedAt = new Date(value.acceptedAt as string).toISOString();
    candidate = planAuthoritativeCommit(
      {
        environment: value.environment as AuthoritativeCommit["environment"],
        aggregateKind: value.aggregateKind as AuthoritativeCommit["aggregateKind"],
        aggregateId: value.aggregateId as string,
        operationId: value.operationId as string,
        commandKind: value.commandKind as string,
        workspaceId: value.workspaceId as string,
        projectId: value.projectId as string,
        actorKind: value.actorKind as AuthoritativeCommit["actorKind"],
        actorId: value.actorId as string,
        payloadDigest: value.payloadDigest as string,
        sealedPayload: value.sealedPayload as string,
        acceptedAt,
      },
      () => expected.id,
    );
  } catch {
    return null;
  }
  if (
    value.version !== 1 ||
    (value.projectionState !== "pending" &&
      value.projectionState !== "processing" &&
      value.projectionState !== "projected" &&
      value.projectionState !== "failed") ||
    typeof value.projectionAttempts !== "number" ||
    !Number.isSafeInteger(value.projectionAttempts) ||
    value.projectionAttempts < 0
  ) {
    return null;
  }
  return candidate;
}

function data(commit: AuthoritativeCommit): Readonly<Record<string, unknown>> {
  const fields: Record<string, unknown> = { ...commit };
  Reflect.deleteProperty(fields, "id");
  return { ...fields, availableAt: commit.acceptedAt };
}

export function createAppwriteAuthoritativeCommitStore(
  tables: AppwriteAuthoritativeCommitTablesPort,
  schema: AppwriteAuthoritativeCommitSchema,
): AuthoritativeCommitStore {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.authoritativeCommitsTableId) ||
    schema.databaseId === schema.authoritativeCommitsTableId
  ) {
    throw new Error("AUTHORITATIVE_COMMIT_SCHEMA_INVALID");
  }
  return {
    async accept(commit) {
      try {
        const created = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.authoritativeCommitsTableId,
          rowId: commit.id,
          data: data(commit),
          permissions: [],
        });
        const canonical = canonicalRow(created, commit);
        if (canonical === null) {
          throw new Error("AUTHORITATIVE_COMMIT_WRITE_INVALID");
        }
        return { status: "applied", commit: canonical };
      } catch (error: unknown) {
        if (!conflict(error)) throw error;
        const existing = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.authoritativeCommitsTableId,
          rowId: commit.id,
        });
        const canonical = canonicalRow(existing, commit);
        if (canonical === null) {
          throw new Error("AUTHORITATIVE_COMMIT_REPLAY_INVALID");
        }
        const replay = resolveAuthoritativeCommitReplay(
          canonical,
          commit.payloadDigest,
        );
        return { status: replay.status, commit: replay.commit };
      }
    },
  };
}
