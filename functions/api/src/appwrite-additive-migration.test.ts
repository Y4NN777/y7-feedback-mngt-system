import { describe, expect, it } from "vitest";

import type { AppwriteTableDefinition } from "./appwrite-schema";
import {
  assertAdditiveRollbackSafe,
  planAdditiveTableMigration,
} from "./appwrite-additive-migration";

function table(id: string): AppwriteTableDefinition {
  return {
    id,
    name: id,
    permissions: [],
    rowSecurity: true,
    enabled: true,
    columns: [{ key: "workspaceId", type: "varchar", size: 36, required: true }],
    indexes: [{ key: "workspace", type: "key", columns: ["workspaceId"] }],
  };
}

describe("additive Appwrite table migration", () => {
  it("BDD-CONV-MIG-001 plans separate Message, Internal Note and idempotency tables", () => {
    const feedback = table("feedback_items");
    const messages = table("conversation_messages");
    const notes = table("conversation_internal_notes");
    const idempotency = table("conversation_idempotency");
    expect(
      planAdditiveTableMigration({
        version: "day3-conversation-v1",
        currentTables: [feedback],
        targetTables: [feedback, messages, notes, idempotency],
        additiveTableIds: [messages.id, notes.id, idempotency.id],
      }),
    ).toEqual({
      version: "day3-conversation-v1",
      createTables: [messages, notes, idempotency],
      rollbackTableIds: [idempotency.id, notes.id, messages.id],
    });
  });

  it("BDD-ADMIN-MIG-001 plans only absent Day 3 tables and a reverse rollback", () => {
    const projects = table("projects");
    const audit = table("administration_audit");
    const idempotency = table("administration_idempotency");

    expect(
      planAdditiveTableMigration({
        version: "day3-admin-v1",
        currentTables: [projects],
        targetTables: [projects, audit, idempotency],
        additiveTableIds: [audit.id, idempotency.id],
      }),
    ).toEqual({
      version: "day3-admin-v1",
      createTables: [audit, idempotency],
      rollbackTableIds: [idempotency.id, audit.id],
    });
  });

  it("BDD-ADMIN-MIG-002 replays a completed migration without mutation", () => {
    const projects = table("projects");
    const audit = table("administration_audit");

    expect(
      planAdditiveTableMigration({
        version: "day3-admin-v1",
        currentTables: [projects, audit],
        targetTables: [projects, audit],
        additiveTableIds: [audit.id],
      }),
    ).toEqual({
      version: "day3-admin-v1",
      createTables: [],
      rollbackTableIds: [],
    });
  });

  it("BDD-ADMIN-MIG-003 rejects changed, removed, duplicate, or undeclared resources", () => {
    const projects = table("projects");
    const changed = {
      ...projects,
      name: "Changed projects",
    } satisfies AppwriteTableDefinition;
    const audit = table("administration_audit");

    const plan = (input: {
      readonly currentTables: readonly AppwriteTableDefinition[];
      readonly targetTables: readonly AppwriteTableDefinition[];
      readonly additiveTableIds: readonly string[];
    }) =>
      planAdditiveTableMigration({
        version: "day3-admin-v1",
        ...input,
      });

    expect(() =>
      plan({
        currentTables: [projects],
        targetTables: [changed, audit],
        additiveTableIds: [audit.id],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_DRIFT");
    expect(() =>
      plan({
        currentTables: [projects],
        targetTables: [audit],
        additiveTableIds: [audit.id],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_DESTRUCTIVE");
    expect(() =>
      plan({
        currentTables: [projects, projects],
        targetTables: [projects, audit],
        additiveTableIds: [audit.id],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    expect(() =>
      plan({
        currentTables: [projects],
        targetTables: [projects, audit],
        additiveTableIds: [],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_UNDECLARED");
  });

  it("BDD-ADMIN-MIG-003 rejects malformed versions, table IDs, and additive declarations", () => {
    const projects = table("projects");
    const audit = table("administration_audit");
    const base = {
      version: "day3-admin-v1",
      currentTables: [projects],
      targetTables: [projects, audit],
      additiveTableIds: [audit.id],
    } as const;

    expect(() => planAdditiveTableMigration({ ...base, version: "Day 3" })).toThrow(
      "APPWRITE_ADDITIVE_MIGRATION_INVALID",
    );
    expect(() =>
      planAdditiveTableMigration({
        ...base,
        currentTables: [{ ...projects, id: "invalid/id" }],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    expect(() =>
      planAdditiveTableMigration({
        ...base,
        targetTables: [projects, audit, audit],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    expect(() =>
      planAdditiveTableMigration({
        ...base,
        additiveTableIds: [audit.id, audit.id],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    expect(() =>
      planAdditiveTableMigration({
        ...base,
        additiveTableIds: ["invalid/id"],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
    expect(() =>
      planAdditiveTableMigration({
        ...base,
        additiveTableIds: ["missing"],
      }),
    ).toThrow("APPWRITE_ADDITIVE_MIGRATION_INVALID");
  });

  it("BDD-ADMIN-MIG-004 permits rollback only for every newly created empty table", () => {
    const audit = table("administration_audit");
    const idempotency = table("administration_idempotency");
    const migration = planAdditiveTableMigration({
      version: "day3-admin-v1",
      currentTables: [],
      targetTables: [audit, idempotency],
      additiveTableIds: [audit.id, idempotency.id],
    });

    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: 0,
        administration_idempotency: 0,
      });
    }).not.toThrow();
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: 1,
        administration_idempotency: 0,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_NON_EMPTY");
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: 0,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_UNVERIFIED");
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: 0,
        administration_idempotency: 0,
        projects: 0,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_UNEXPECTED");
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: Number.NaN,
        administration_idempotency: 0,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_UNVERIFIED");
    expect(() => {
      assertAdditiveRollbackSafe(migration, {
        administration_audit: -1,
        administration_idempotency: 0,
      });
    }).toThrow("APPWRITE_ADDITIVE_ROLLBACK_UNVERIFIED");
  });
});
