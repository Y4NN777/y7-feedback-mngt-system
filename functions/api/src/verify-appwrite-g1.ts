import { randomBytes, randomUUID } from "node:crypto";

import { Client, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access.js";
import { createHttpApplication } from "./application.js";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository.js";
import { runAppwriteG1Matrix, type AppwriteG1MatrixIds } from "./appwrite-g1-matrix.js";
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

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) throw new Error("APPWRITE_G1_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G1_NON_PRODUCTION_REQUIRED");
  }

  const suffix = randomBytes(8).toString("hex");
  const ids: AppwriteG1MatrixIds = {
    feedbackId: `g1f_${suffix}`,
    reporterId: `g1r_${suffix}`,
    notificationId: `g1n_${suffix}`,
    lifecycleId: `g1l_${suffix}`,
    outboxId: `g1o_${suffix}`,
  };
  const idQueue = [
    ids.feedbackId,
    ids.reporterId,
    ids.notificationId,
    ids.lifecycleId,
    ids.outboxId,
  ];
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = instrument(new TablesDB(client));
  const dependencies = createHttpApplication(config, {
    tables,
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
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...result })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^APPWRITE_G1_[A-Z_]+$/u.test(error.message)
      ? error.message
      : "APPWRITE_G1_FAILED";
  process.stderr.write(
    `${JSON.stringify({ status: "error", code, service: lastServiceFailure })}\n`,
  );
  process.exitCode = 1;
});
