import { randomBytes } from "node:crypto";

import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import {
  assertAdditiveRollbackSafe,
  planAdditiveTableMigration,
} from "./appwrite-additive-migration.js";
import { createDay4TableDefinitions } from "./appwrite-day4-migration.js";
import { createNodeAppwriteProvisioningPort } from "./appwrite-provisioner-node.js";
import { provisionAppwriteInfrastructure } from "./appwrite-provisioner.js";
import { createAppwriteInfrastructureManifest } from "./appwrite-schema.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("D4_MIGRATION_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview") {
    throw new Error("D4_MIGRATION_PREVIEW_REQUIRED");
  }

  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const port = createNodeAppwriteProvisioningPort(tables, new Storage(client));
  const manifest = createAppwriteInfrastructureManifest(config.appwriteSchema);
  const d4Definitions = createDay4TableDefinitions(config.appwriteSchema);
  const before = await Promise.all(
    d4Definitions.map(({ id }) => port.getTable(manifest.database.id, id)),
  );
  const forward = await provisionAppwriteInfrastructure(port, manifest);
  const replay = await provisionAppwriteInfrastructure(port, manifest);
  if (replay.created !== 0) throw new Error("D4_MIGRATION_REPLAY_MUTATED");

  const suffix = randomBytes(4).toString("hex");
  const temporary = d4Definitions.map((definition, index) => ({
    ...definition,
    id: `d4m_${suffix}_${String(index + 1)}`,
    name: `D4 migration proof ${String(index + 1)}`,
  }));
  const rollbackPlan = planAdditiveTableMigration({
    version: "day4-rollback-proof-v1",
    currentTables: manifest.tables,
    targetTables: [...manifest.tables, ...temporary],
    additiveTableIds: temporary.map(({ id }) => id),
  });
  const createdTemporary: string[] = [];
  let nonEmptyRollbackDenied = false;
  let cleanupFailure: unknown;
  try {
    for (const definition of rollbackPlan.createTables) {
      await tables.createTable({
        databaseId: manifest.database.id,
        tableId: definition.id,
        name: definition.name,
        permissions: [...definition.permissions],
        rowSecurity: definition.rowSecurity,
        enabled: definition.enabled,
        columns: definition.columns.map((column) => ({ ...column })),
        indexes: definition.indexes.map((index) => ({
          key: index.key,
          type: index.type,
          attributes: [...index.columns],
        })),
      });
      createdTemporary.push(definition.id);
    }

    const counter = temporary[5];
    if (!counter) throw new Error("D4_MIGRATION_PROOF_INVALID");
    const rowId = `proof_${suffix}`;
    await tables.createRow({
      databaseId: manifest.database.id,
      tableId: counter.id,
      rowId,
      permissions: [],
      data: {
        dimension: "preview-proof",
        subjectDigest: "0".repeat(64),
        keyId: "proof",
        count: 1,
        windowStartedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:01:00.000Z",
      },
    });
    try {
      assertAdditiveRollbackSafe(
        rollbackPlan,
        Object.fromEntries(
          rollbackPlan.rollbackTableIds.map((id) => [id, id === counter.id ? 1 : 0]),
        ),
      );
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        error.message !== "APPWRITE_ADDITIVE_ROLLBACK_NON_EMPTY"
      ) {
        throw error;
      }
      nonEmptyRollbackDenied = true;
    }
    await tables.deleteRow({
      databaseId: manifest.database.id,
      tableId: counter.id,
      rowId,
    });
    assertAdditiveRollbackSafe(
      rollbackPlan,
      Object.fromEntries(rollbackPlan.rollbackTableIds.map((id) => [id, 0])),
    );
  } finally {
    for (const tableId of [...createdTemporary].reverse()) {
      try {
        await tables.deleteTable({ databaseId: manifest.database.id, tableId });
      } catch (error: unknown) {
        if (!absent(error) && cleanupFailure === undefined) cleanupFailure = error;
      }
    }
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("D4_MIGRATION_CLEANUP_FAILED");
  }

  const residue = await Promise.all(
    temporary.map(async ({ id }) => {
      try {
        await tables.getTable({ databaseId: manifest.database.id, tableId: id });
        return id;
      } catch (error: unknown) {
        if (absent(error)) return null;
        throw error;
      }
    }),
  );
  if (residue.some((id) => id !== null) || !nonEmptyRollbackDenied) {
    throw new Error("D4_MIGRATION_CLEANUP_FAILED");
  }

  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_D4_MIGRATION_PASSED",
      permanentTablesCreated: before.filter((value) => value === null).length,
      forwardCreatedResources: forward.created,
      replayCreatedResources: replay.created,
      rollbackTables: rollbackPlan.rollbackTableIds.length,
      nonEmptyRollbackDenied,
      cleanupPassed: true,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "D4_MIGRATION_FAILED";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
