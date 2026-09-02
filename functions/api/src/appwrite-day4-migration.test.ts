import { describe, expect, it } from "vitest";

import { assertAdditiveRollbackSafe } from "./appwrite-additive-migration";
import { createAppwriteInfrastructureManifest } from "./appwrite-schema";
import { createDay4AdditiveMigration, day4TableIds } from "./appwrite-day4-migration";
import { schema } from "./appwrite-schema.test-fixture";

describe("Day 4 additive Appwrite migration", () => {
  const g3Tables = () =>
    createAppwriteInfrastructureManifest(schema).tables.filter(
      ({ id }) => !(day4TableIds as readonly string[]).includes(id),
    );

  it("BDD-D4-MIG-001 adds every D4 control-plane boundary without changing G3 tables", () => {
    const current = g3Tables();
    const migration = createDay4AdditiveMigration(current);

    expect(migration.version).toBe("day4-control-plane-v1");
    expect(migration.createTables.map(({ id }) => id)).toEqual(day4TableIds);
    expect(migration.rollbackTableIds).toEqual([...day4TableIds].reverse());
    expect(
      migration.createTables.map(({ enabled, permissions, rowSecurity }) => ({
        enabled,
        permissions,
        rowSecurity,
      })),
    ).toEqual(
      day4TableIds.map(() => ({
        enabled: true,
        permissions: [],
        rowSecurity: true,
      })),
    );
  });

  it("BDD-D4-MIG-002 is replay-safe and preserves forward compatibility", () => {
    const current = g3Tables();
    const first = createDay4AdditiveMigration(current);
    const replay = createDay4AdditiveMigration([...current, ...first.createTables]);

    expect(replay.createTables).toEqual([]);
    expect(replay.rollbackTableIds).toEqual([]);
  });

  it("BDD-D4-MIG-003 permits rollback only before any D4 fact exists", () => {
    const migration = createDay4AdditiveMigration(g3Tables());
    const empty = Object.fromEntries(day4TableIds.map((id) => [id, 0]));

    expect(() => {
      assertAdditiveRollbackSafe(migration, empty);
    }).not.toThrow();
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        ...empty,
        provider_event_inbox: 1,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_NON_EMPTY");
  });

  it("BDD-D4-MIG-004 gives inbox/outbox durable dedupe, ordering and retry indexes", () => {
    const migration = createDay4AdditiveMigration(g3Tables());
    const byId = new Map(migration.createTables.map((table) => [table.id, table]));

    expect(byId.get("provider_event_inbox")?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "provider_delivery_unique", type: "unique" }),
        expect.objectContaining({ key: "status_available", type: "key" }),
        expect.objectContaining({ key: "connection_order", type: "key" }),
      ]),
    );
    expect(byId.get("provider_sync_outbox")?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "operation_unique", type: "unique" }),
        expect.objectContaining({ key: "status_next_attempt", type: "key" }),
        expect.objectContaining({ key: "link_order", type: "unique" }),
      ]),
    );
  });

  it("BDD-INT-309 evolves provenance additively for correction history", () => {
    const provenance = createDay4AdditiveMigration(g3Tables()).createTables.find(
      ({ id }) => id === "intelligence_provenance",
    );

    expect(
      provenance?.columns
        .filter(({ key }) =>
          [
            "associationKind",
            "targetEnvelope",
            "relatedFeedbackId",
            "provenanceEnvelope",
            "revision",
            "updatedByActorId",
            "updatedAt",
            "operationIdsJson",
          ].includes(key),
        )
        .map(({ key, required }) => ({ key, required })),
    ).toEqual([
      { key: "associationKind", required: false },
      { key: "targetEnvelope", required: false },
      { key: "relatedFeedbackId", required: false },
      { key: "provenanceEnvelope", required: false },
      { key: "revision", required: false },
      { key: "updatedByActorId", required: false },
      { key: "updatedAt", required: false },
      { key: "operationIdsJson", required: false },
    ]);
  });

  it("BDD-PRIV-009 evolves deletion records additively for immutable audit", () => {
    const deletion = createDay4AdditiveMigration(g3Tables()).createTables.find(
      ({ id }) => id === "deletion_records",
    );
    expect(
      deletion?.columns
        .filter(({ key }) =>
          [
            "revision",
            "identityErased",
            "auditEnvelope",
            "operationIdsJson",
            "updatedAt",
            "purgeWorkerId",
            "purgeClaimedAt",
          ].includes(key),
        )
        .map(({ key, required }) => ({ key, required })),
    ).toEqual([
      { key: "revision", required: false },
      { key: "identityErased", required: false },
      { key: "auditEnvelope", required: false },
      { key: "operationIdsJson", required: false },
      { key: "updatedAt", required: false },
      { key: "purgeWorkerId", required: false },
      { key: "purgeClaimedAt", required: false },
    ]);
  });
});
