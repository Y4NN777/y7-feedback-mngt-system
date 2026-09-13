import { createHash } from "node:crypto";

import { planAuthoritativeCommit } from "@y7-feedback/domain";
import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type {
  AuthoritativeProjectionStore,
  ClaimedAuthoritativeCommit,
} from "./authoritative-projector.js";

export interface AppwriteAuthoritativeProjectionTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
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
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
}

export interface AppwriteAuthoritativeProjectionQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

export interface AppwriteAuthoritativeProjectionSchema {
  readonly databaseId: string;
  readonly authoritativeCommitsTableId: string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const diagnosticCode = /^[A-Z][A-Z0-9_]{2,63}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function conflict(error: unknown): boolean {
  return object(error) && error.code === 409;
}

function commitFromRow(value: Readonly<Record<string, unknown>>): AuthoritativeCommit {
  try {
    return planAuthoritativeCommit(
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
        acceptedAt: value.acceptedAt as string,
      },
      () => value.$id as string,
    );
  } catch {
    throw new Error("AUTHORITATIVE_PROJECTION_ROW_INVALID");
  }
}

function candidate(
  value: unknown,
  now: string,
): Readonly<Record<string, unknown>> | undefined {
  if (
    !object(value) ||
    !identifier.test(value.$id as string) ||
    !Number.isSafeInteger(value.projectionAttempts) ||
    (value.projectionAttempts as number) < 0 ||
    !instant(value.availableAt)
  ) {
    return undefined;
  }
  if (
    (value.projectionState === "pending" || value.projectionState === "failed") &&
    value.availableAt <= now
  ) {
    return value;
  }
  if (
    value.projectionState === "processing" &&
    instant(value.claimedUntil) &&
    value.claimedUntil <= now
  ) {
    return value;
  }
  return undefined;
}

function claimToken(
  rowId: string,
  workerId: string,
  attempt: number,
  leaseUntil: string,
) {
  return `lease_${createHash("sha256")
    .update(rowId)
    .update("\0")
    .update(workerId)
    .update("\0")
    .update(String(attempt))
    .update("\0")
    .update(leaseUntil)
    .digest("hex")
    .slice(0, 30)}`;
}

export function createAppwriteAuthoritativeProjectionStore(
  tables: AppwriteAuthoritativeProjectionTablesPort,
  schema: AppwriteAuthoritativeProjectionSchema,
  queries: AppwriteAuthoritativeProjectionQueryPort,
): AuthoritativeProjectionStore {
  if (
    !identifier.test(schema.databaseId) ||
    !identifier.test(schema.authoritativeCommitsTableId) ||
    schema.databaseId === schema.authoritativeCommitsTableId
  ) {
    throw new Error("AUTHORITATIVE_PROJECTION_SCHEMA_INVALID");
  }

  async function transaction<T>(
    work: (transactionId: string) => Promise<T>,
  ): Promise<T> {
    const created = await tables.createTransaction({ ttl: 60 });
    if (!identifier.test(created.$id)) {
      throw new Error("AUTHORITATIVE_PROJECTION_TRANSACTION_INVALID");
    }
    try {
      const result = await work(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error: unknown) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        // Preserve the originating projection failure.
      }
      throw error;
    }
  }

  async function transition(
    input: {
      readonly commitId: string;
      readonly leaseToken: string;
      readonly attempt: number;
    },
    data: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (
      !identifier.test(input.commitId) ||
      !identifier.test(input.leaseToken) ||
      !Number.isSafeInteger(input.attempt) ||
      input.attempt < 1
    ) {
      throw new Error("AUTHORITATIVE_PROJECTION_TRANSITION_INVALID");
    }
    await transaction(async (transactionId) => {
      const current = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.authoritativeCommitsTableId,
        rowId: input.commitId,
        transactionId,
      });
      if (
        !object(current) ||
        current.$id !== input.commitId ||
        current.projectionState !== "processing" ||
        current.claimToken !== input.leaseToken ||
        current.projectionAttempts !== input.attempt
      ) {
        throw new Error("AUTHORITATIVE_PROJECTION_LEASE_LOST");
      }
      const updated = await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.authoritativeCommitsTableId,
        rowId: input.commitId,
        data: { ...data, claimedBy: null, claimToken: null, claimedUntil: null },
        transactionId,
      });
      if (!object(updated) || updated.$id !== input.commitId) {
        throw new Error("AUTHORITATIVE_PROJECTION_WRITE_INVALID");
      }
    });
  }

  return {
    async claim(input): Promise<ClaimedAuthoritativeCommit | null> {
      if (
        !identifier.test(input.workerId) ||
        !instant(input.now) ||
        !instant(input.leaseUntil) ||
        input.leaseUntil <= input.now
      ) {
        throw new Error("AUTHORITATIVE_PROJECTION_CLAIM_INVALID");
      }
      try {
        return await transaction(async (transactionId) => {
          const listed = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.authoritativeCommitsTableId,
            queries: [
              queries.equal("projectionState", ["pending", "failed", "processing"]),
              queries.orderAsc("availableAt"),
              queries.limit(25),
            ],
            total: false,
            ttl: 60,
            transactionId,
          });
          const row = listed.rows
            .map((value) => candidate(value, input.now))
            .find((value) => value !== undefined);
          if (row === undefined) return null;
          const commit = commitFromRow(row);
          const attempt = (row.projectionAttempts as number) + 1;
          const leaseToken = claimToken(
            commit.id,
            input.workerId,
            attempt,
            input.leaseUntil,
          );
          const updated = await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.authoritativeCommitsTableId,
            rowId: commit.id,
            data: {
              projectionState: "processing",
              projectionAttempts: attempt,
              claimedBy: input.workerId,
              claimToken: leaseToken,
              claimedUntil: input.leaseUntil,
            },
            transactionId,
          });
          if (
            !object(updated) ||
            updated.$id !== commit.id ||
            updated.projectionState !== "processing" ||
            updated.projectionAttempts !== attempt ||
            updated.claimToken !== leaseToken
          ) {
            throw new Error("AUTHORITATIVE_PROJECTION_WRITE_INVALID");
          }
          return { commit, attempt, leaseToken };
        });
      } catch (error: unknown) {
        if (conflict(error)) return null;
        throw error;
      }
    },
    projected(input) {
      if (!instant(input.projectedAt)) {
        return Promise.reject(new Error("AUTHORITATIVE_PROJECTION_TRANSITION_INVALID"));
      }
      return transition(input, {
        projectionState: "projected",
        projectedAt: input.projectedAt,
        lastErrorCode: null,
      });
    },
    retry(input) {
      if (!instant(input.availableAt) || !diagnosticCode.test(input.errorCode)) {
        return Promise.reject(new Error("AUTHORITATIVE_PROJECTION_TRANSITION_INVALID"));
      }
      return transition(input, {
        projectionState: "failed",
        availableAt: input.availableAt,
        lastErrorCode: input.errorCode,
      });
    },
  };
}
