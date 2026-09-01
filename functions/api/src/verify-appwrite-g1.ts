import { randomBytes, randomUUID } from "node:crypto";

import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access.js";
import { createHttpApplication } from "./application.js";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository.js";
import { runAppwriteG1OutboxMatrix } from "./appwrite-g1-outbox-matrix.js";
import {
  runAppwriteG1Matrix,
  runAppwriteG1RollbackMatrix,
  type AppwriteG1MatrixIds,
} from "./appwrite-g1-matrix.js";
import { createNodeAppwriteOutboxStore } from "./appwrite-outbox-store.js";
import { createOutboxWorker } from "./outbox.js";
import {
  createAccessProof,
  hashAccessProof,
  matchesAccessProof,
} from "./proof-crypto.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

interface SafeServiceFailure {
  readonly status: number | null;
  readonly type: string | null;
  readonly operation: string | null;
  readonly tableId: string | null;
}

let lastServiceFailure: SafeServiceFailure | undefined;
let latestMutationTableId: string | null = null;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureServiceFailure(
  error: unknown,
  property: string | symbol,
  args: readonly unknown[],
): void {
  if (!isObject(error)) return;
  const status =
    typeof error.code === "number" && Number.isSafeInteger(error.code)
      ? error.code
      : null;
  const type =
    typeof error.type === "string" && /^[a-z][a-z0-9_]{0,100}$/u.test(error.type)
      ? error.type
      : null;
  const input = args[0];
  const inputTableId =
    isObject(input) &&
    typeof input.tableId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(input.tableId)
      ? input.tableId
      : null;
  const tableId = inputTableId ?? latestMutationTableId;
  const operation =
    typeof property === "string" && /^[A-Za-z][A-Za-z0-9]{0,50}$/u.test(property)
      ? property
      : null;
  if (status !== 404 && lastServiceFailure === undefined) {
    lastServiceFailure = { status, type, operation, tableId };
  }
}

function instrument(tables: TablesDB): TablesDB {
  return new Proxy(tables, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: readonly unknown[]) => {
        const input = args[0];
        if (
          property === "createRow" &&
          isObject(input) &&
          typeof input.tableId === "string"
        ) {
          latestMutationTableId = input.tableId;
        }
        return Promise.resolve(Reflect.apply(value, target, args)).catch(
          (error: unknown) => {
            captureServiceFailure(error, property, args);
            throw error;
          },
        );
      };
    },
  });
}

function failCreateForTable(tables: TablesDB, tableId: string): TablesDB {
  return new Proxy(tables, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property !== "createRow") {
        return (...args: readonly unknown[]) =>
          Reflect.apply(value, target, args) as unknown;
      }
      return (...args: readonly unknown[]) => {
        const input = args[0];
        if (isObject(input) && input.tableId === tableId) {
          return Promise.reject(new Error("APPWRITE_G1_FORCED_ROW_FAILURE"));
        }
        return Reflect.apply(value, target, args) as unknown;
      };
    },
  });
}

function matrixIds(suffix: string): AppwriteG1MatrixIds {
  return {
    feedbackId: `g1f_${suffix}`,
    reporterId: `g1r_${suffix}`,
    notificationId: `g1n_${suffix}`,
    lifecycleId: `g1l_${suffix}`,
    outboxId: `g1o_${suffix}`,
  };
}

function idSequence(ids: AppwriteG1MatrixIds): string[] {
  return [
    ids.feedbackId,
    ids.reporterId,
    ids.notificationId,
    ids.lifecycleId,
    ids.outboxId,
  ];
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) throw new Error("APPWRITE_G1_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G1_NON_PRODUCTION_REQUIRED");
  }

  const suffix = randomBytes(8).toString("hex");
  const ids = matrixIds(suffix);
  const idQueue = idSequence(ids);
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = instrument(new TablesDB(client));
  const storage = new Storage(client);
  const dependencies = createHttpApplication(config, {
    tables,
    storage,
    createId: () => {
      const id = idQueue.shift();
      if (!id) throw new Error("APPWRITE_G1_ID_SEQUENCE_INVALID");
      return id;
    },
    createReference: () => `Y7-G1-${suffix.toUpperCase()}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
  });
  if (!dependencies.publicApi) throw new Error("APPWRITE_G1_API_INVALID");
  const sensitive = {
    environment: config.environment,
    protector: createSensitiveDataProtector(
      config.sensitiveDataActiveKeyId,
      Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
        id,
        material: Buffer.from(material, "base64url"),
      })),
    ),
  };
  const accountless = createAccountlessAccessCoordinator(
    createNodeAppwriteAccountlessRepository(tables, config.appwriteSchema, sensitive),
    {
      matchesProof: matchesAccessProof,
      rotation: { createProof: createAccessProof, hashProof: hashAccessProof },
    },
  );
  const result = await runAppwriteG1Matrix(
    dependencies.publicApi,
    tables,
    config.appwriteSchema,
    ids,
    randomUUID(),
    accountless,
  );
  if (idQueue.length !== 0) throw new Error("APPWRITE_G1_ID_SEQUENCE_INVALID");

  const rollbackSuffix = randomBytes(8).toString("hex");
  const rollbackIds = matrixIds(rollbackSuffix);
  const rollbackIdQueue = idSequence(rollbackIds);
  const rollbackTables = failCreateForTable(
    tables,
    config.appwriteSchema.lifecycleTableId,
  );
  const rollbackDependencies = createHttpApplication(config, {
    tables: rollbackTables,
    storage,
    createId: () => {
      const id = rollbackIdQueue.shift();
      if (!id) throw new Error("APPWRITE_G1_ID_SEQUENCE_INVALID");
      return id;
    },
    createReference: () => `Y7-G1-${rollbackSuffix.toUpperCase()}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
  });
  if (!rollbackDependencies.publicApi) throw new Error("APPWRITE_G1_API_INVALID");
  const rollback = await runAppwriteG1RollbackMatrix(
    rollbackDependencies.publicApi,
    tables,
    config.appwriteSchema,
    rollbackIds,
    randomUUID(),
  );
  if (rollbackIdQueue.length !== 0) {
    throw new Error("APPWRITE_G1_ID_SEQUENCE_INVALID");
  }

  const retrySuffix = randomBytes(8).toString("hex");
  const permanentSuffix = randomBytes(8).toString("hex");
  const retryIds = matrixIds(retrySuffix);
  const permanentIds = matrixIds(permanentSuffix);
  const outboxIdQueue = [...idSequence(retryIds), ...idSequence(permanentIds)];
  let referenceIndex = 0;
  const outboxDependencies = createHttpApplication(config, {
    tables,
    storage,
    createId: () => {
      const id = outboxIdQueue.shift();
      if (!id) throw new Error("APPWRITE_G1_ID_SEQUENCE_INVALID");
      return id;
    },
    createReference: () =>
      `Y7-G1-${retrySuffix.toUpperCase()}-${String(++referenceIndex)}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
  });
  if (!outboxDependencies.publicApi) throw new Error("APPWRITE_G1_API_INVALID");
  const deliveryOutcomes = ["retryable", "delivered", "permanent"] as const;
  let deliveryIndex = 0;
  let outboxClock = Date.now();
  const outboxWorker = createOutboxWorker({
    store: createNodeAppwriteOutboxStore(
      tables,
      config.appwriteSchema,
      sensitive,
      new Set([retryIds.outboxId, permanentIds.outboxId]),
    ),
    sender: {
      deliver: () => {
        const outcome = deliveryOutcomes[deliveryIndex++];
        if (!outcome) throw new Error("APPWRITE_G1_DELIVERY_SEQUENCE_INVALID");
        return Promise.resolve(outcome);
      },
    },
    workerId: "g1_preview_worker",
    createLeaseToken: () => randomBytes(16).toString("base64url"),
    now: () => {
      outboxClock += 2_000;
      return new Date(outboxClock);
    },
    leaseDurationMs: 30_000,
    retryDelayMs: () => 1_000,
    maximumAttempts: 3,
    log: () => undefined,
  });
  const outbox = await runAppwriteG1OutboxMatrix(
    outboxDependencies.publicApi,
    outboxWorker,
    tables,
    config.appwriteSchema,
    {
      retryIds,
      permanentIds,
      retryOperationId: randomUUID(),
      permanentOperationId: randomUUID(),
    },
  );
  if (outboxIdQueue.length !== 0 || deliveryIndex !== 3) {
    throw new Error("APPWRITE_G1_DELIVERY_SEQUENCE_INVALID");
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...result, rollback, outbox })}\n`,
  );
}

function safeFailureCode(error: unknown): string {
  let current = error;
  let code = "APPWRITE_G1_FAILED";
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/^(?:APPWRITE_(?:G1|OUTBOX)|OUTBOX)_[A-Z_]+$/u.test(current.message)) {
      code = current.message;
    }
    current = current.cause;
  }
  return code;
}

function safeFailureChain(error: unknown): readonly string[] {
  const result: string[] = [];
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (/^[A-Z][A-Z0-9_:.-]{2,200}$/u.test(current.message)) {
      result.push(current.message);
    }
    current = current.cause;
  }
  return result;
}

main().catch((error: unknown) => {
  const code = safeFailureCode(error);
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      code,
      chain: safeFailureChain(error),
      service: lastServiceFailure,
    })}\n`,
  );
  process.exitCode = 1;
});
