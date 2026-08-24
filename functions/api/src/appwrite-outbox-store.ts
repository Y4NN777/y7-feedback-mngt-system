import { Query, type TablesDB } from "node-appwrite";

import type {
  ClaimedOutboxDelivery,
  OutboxChannel,
  OutboxClaimRequest,
  OutboxDeliveryStore,
} from "./outbox.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteOutboxSchema {
  readonly databaseId: string;
  readonly outboxTableId: string;
}

export interface AppwriteOutboxTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
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
  isConflict(error: unknown): boolean;
}

export interface AppwriteOutboxQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly orderAsc: (attribute: string) => string;
  readonly limit: (limit: number) => string;
}

interface DeliveryState {
  readonly attempts: number;
  readonly nextAttemptAt?: string;
  readonly lease?: {
    readonly token: string;
    readonly workerId: string;
    readonly until: string;
  };
  readonly deliveredAt?: string;
  readonly failedAt?: string;
  readonly failureReason?: "permanent" | "attempts_exhausted";
}

interface ParsedOutboxRow {
  readonly id: string;
  readonly notificationId: string;
  readonly channel: OutboxChannel;
  readonly status: "pending" | "retryable" | "processing" | "delivered" | "failed";
  readonly createdAt: string;
  readonly message: unknown;
  readonly delivery: DeliveryState;
}

const defaultQueries: AppwriteOutboxQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (limit) => Query.limit(limit),
};

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const token = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const statuses = new Set(["pending", "retryable", "processing", "delivered", "failed"]);

function invalid(): never {
  throw new Error("APPWRITE_OUTBOX_ROW_INVALID");
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: unknown, maximum = 10_000): string {
  if (typeof value !== "string" || !value || value.length > maximum) return invalid();
  return value;
}

function instant(value: unknown): string {
  const candidate = required(value, 40);
  try {
    if (!/(?:Z|[+]00:00)$/u.test(candidate)) return invalid();
    return new Date(candidate).toISOString();
  } catch {
    return invalid();
  }
}

function deliveryState(value: unknown): DeliveryState {
  if (!isObject(value)) return invalid();
  const attempts = value.attempts;
  if (!Number.isSafeInteger(attempts) || Number(attempts) < 0) return invalid();
  const lease = value.lease;
  const parsedLease =
    lease === undefined
      ? undefined
      : isObject(lease) &&
          token.test(required(lease.token, 64)) &&
          token.test(required(lease.workerId, 64))
        ? {
            token: required(lease.token, 64),
            workerId: required(lease.workerId, 64),
            until: instant(lease.until),
          }
        : invalid();
  const failureReason = value.failureReason;
  if (
    failureReason !== undefined &&
    failureReason !== "permanent" &&
    failureReason !== "attempts_exhausted"
  ) {
    return invalid();
  }
  return {
    attempts: Number(attempts),
    ...(value.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: instant(value.nextAttemptAt) }),
    ...(parsedLease === undefined ? {} : { lease: parsedLease }),
    ...(value.deliveredAt === undefined
      ? {}
      : { deliveredAt: instant(value.deliveredAt) }),
    ...(value.failedAt === undefined ? {} : { failedAt: instant(value.failedAt) }),
    ...(failureReason === undefined ? {} : { failureReason }),
  };
}

function parseRow(
  value: unknown,
  schema: AppwriteOutboxSchema,
  sensitive: AppwriteSensitivePersistence,
): ParsedOutboxRow {
  if (!isObject(value)) return invalid();
  const id = required(value.$id, 36);
  if (!appwriteId.test(id)) return invalid();
  const channel = value.channel;
  if (channel !== "email" && channel !== "in_product") return invalid();
  const status = required(value.status, 32);
  if (!statuses.has(status)) return invalid();
  let payload: unknown;
  try {
    payload = JSON.parse(
      sensitive.protector.open(
        {
          environment: sensitive.environment,
          tableId: schema.outboxTableId,
          rowId: id,
          field: "payloadJson",
        },
        required(value.payloadJson, 1_000_000),
      ),
    ) as unknown;
  } catch {
    return invalid();
  }
  const wrapped =
    isObject(payload) && payload.version === 1 && "message" in payload
      ? { message: payload.message, delivery: deliveryState(payload.delivery) }
      : { message: payload, delivery: { attempts: 0 } };
  return {
    id,
    notificationId: required(value.notificationId, 36),
    channel,
    status: status as ParsedOutboxRow["status"],
    createdAt: instant(value.createdAt),
    message: wrapped.message,
    delivery: wrapped.delivery,
  };
}

function eligible(row: ParsedOutboxRow, now: string): boolean {
  if (row.status === "pending") return true;
  if (row.status === "retryable") {
    return (
      row.delivery.nextAttemptAt !== undefined && row.delivery.nextAttemptAt <= now
    );
  }
  return (
    row.status === "processing" &&
    row.delivery.lease !== undefined &&
    row.delivery.lease.until <= now
  );
}

function protectedPayload(
  row: ParsedOutboxRow,
  delivery: DeliveryState,
  schema: AppwriteOutboxSchema,
  sensitive: AppwriteSensitivePersistence,
): string {
  return sensitive.protector.seal(
    {
      environment: sensitive.environment,
      tableId: schema.outboxTableId,
      rowId: row.id,
      field: "payloadJson",
    },
    JSON.stringify({ version: 1, message: row.message, delivery }),
  );
}

async function rollback(tables: AppwriteOutboxTablesPort, transactionId: string) {
  try {
    await tables.updateTransaction({ transactionId, rollback: true });
  } catch {
    // Preserve the originating transaction failure.
  }
}

export function createAppwriteOutboxStore(
  tables: AppwriteOutboxTablesPort,
  schema: AppwriteOutboxSchema,
  queries: AppwriteOutboxQueryPort,
  sensitive: AppwriteSensitivePersistence,
  candidateGuard: (outboxId: string) => boolean = () => true,
): OutboxDeliveryStore {
  if (!appwriteId.test(schema.databaseId) || !appwriteId.test(schema.outboxTableId)) {
    throw new Error("APPWRITE_OUTBOX_SCHEMA_INVALID");
  }

  async function transition(
    outboxId: string,
    leaseToken: string,
    status: "retryable" | "delivered" | "failed",
    update: (state: DeliveryState) => DeliveryState,
  ): Promise<void> {
    const transaction = await tables.createTransaction({ ttl: 60 });
    if (!appwriteId.test(transaction.$id)) {
      throw new Error("APPWRITE_OUTBOX_TRANSACTION_INVALID");
    }
    try {
      const row = parseRow(
        await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.outboxTableId,
          rowId: outboxId,
          transactionId: transaction.$id,
        }),
        schema,
        sensitive,
      );
      if (row.status !== "processing" || row.delivery.lease?.token !== leaseToken) {
        throw new Error("APPWRITE_OUTBOX_LEASE_LOST");
      }
      await tables.updateRow({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        rowId: row.id,
        data: {
          status,
          payloadJson: protectedPayload(row, update(row.delivery), schema, sensitive),
        },
        transactionId: transaction.$id,
      });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error: unknown) {
      await rollback(tables, transaction.$id);
      throw error;
    }
  }

  return {
    async claim(request: OutboxClaimRequest): Promise<ClaimedOutboxDelivery | null> {
      const candidates = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.outboxTableId,
        queries: [
          queries.equal("status", ["pending", "retryable", "processing"]),
          queries.orderAsc("createdAt"),
          queries.limit(25),
        ],
        total: false,
        ttl: 0,
      });
      for (const candidate of candidates.rows) {
        const listed = parseRow(candidate, schema, sensitive);
        if (!candidateGuard(listed.id)) continue;
        if (!eligible(listed, request.now)) continue;
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) {
          throw new Error("APPWRITE_OUTBOX_TRANSACTION_INVALID");
        }
        try {
          const row = parseRow(
            await tables.getRow({
              databaseId: schema.databaseId,
              tableId: schema.outboxTableId,
              rowId: listed.id,
              transactionId: transaction.$id,
            }),
            schema,
            sensitive,
          );
          if (!eligible(row, request.now)) {
            await rollback(tables, transaction.$id);
            continue;
          }
          const delivery: DeliveryState = {
            attempts: row.delivery.attempts + 1,
            lease: {
              token: request.leaseToken,
              workerId: request.workerId,
              until: request.leaseUntil,
            },
          };
          await tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.outboxTableId,
            rowId: row.id,
            data: {
              status: "processing",
              payloadJson: protectedPayload(row, delivery, schema, sensitive),
            },
            transactionId: transaction.$id,
          });
          await tables.updateTransaction({
            transactionId: transaction.$id,
            commit: true,
          });
          return {
            outboxId: row.id,
            deliveryId: row.notificationId,
            channel: row.channel,
            payload: row.message,
            attempt: delivery.attempts,
            leaseToken: request.leaseToken,
          };
        } catch (error: unknown) {
          await rollback(tables, transaction.$id);
          if (tables.isConflict(error)) continue;
          throw error;
        }
      }
      return null;
    },
    markDelivered: (input) =>
      transition(input.outboxId, input.leaseToken, "delivered", (state) => ({
        attempts: state.attempts,
        deliveredAt: input.deliveredAt,
      })),
    reschedule: (input) =>
      transition(input.outboxId, input.leaseToken, "retryable", (state) => ({
        attempts: state.attempts,
        nextAttemptAt: input.nextAttemptAt,
      })),
    markFailed: (input) =>
      transition(input.outboxId, input.leaseToken, "failed", (state) => ({
        attempts: state.attempts,
        failedAt: input.failedAt,
        failureReason: input.reason,
      })),
  };
}

export function createNodeAppwriteOutboxStore(
  tables: TablesDB,
  schema: AppwriteOutboxSchema,
  sensitive: AppwriteSensitivePersistence,
  allowedOutboxIds?: ReadonlySet<string>,
): OutboxDeliveryStore {
  if (allowedOutboxIds?.size === 0) {
    throw new Error("APPWRITE_OUTBOX_CANDIDATES_INVALID");
  }
  for (const id of allowedOutboxIds ?? []) {
    if (!appwriteId.test(id)) throw new Error("APPWRITE_OUTBOX_CANDIDATES_INVALID");
  }
  return createAppwriteOutboxStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      listRows: async (input) => {
        const result = await tables.listRows(input);
        return { rows: result.rows };
      },
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
      isConflict: (error) =>
        isObject(error) && (error.code === 409 || error.type === "row_conflict"),
    },
    schema,
    defaultQueries,
    sensitive,
    allowedOutboxIds === undefined ? () => true : (id) => allowedOutboxIds.has(id),
  );
}
