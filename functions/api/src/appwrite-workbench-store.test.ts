import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import {
  AppwriteWorkbenchError,
  createAppwriteWorkbenchStore,
  type AppwriteWorkbenchTablesPort,
} from "./appwrite-workbench-store";
import { createSensitiveDataProtector } from "./sensitive-data-protector";

const schema = { databaseId: "feedback", feedbackTableId: "feedback_items" };
const sensitive = {
  environment: "preview" as const,
  protector: createSensitiveDataProtector("key_1", [
    { id: "key_1", material: Buffer.alloc(32, 7) },
  ]),
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const owner: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

function envelope(rowId: string, field: string, value: unknown): string {
  return sensitive.protector.seal(
    { environment: "preview", tableId: "feedback_items", rowId, field },
    JSON.stringify(value),
  );
}

function row(id: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: id,
    workspaceId: "workspace_1",
    projectId: "project_1",
    reporterId: "reporter_1",
    type: "bug",
    state: "received",
    acceptedAt: "2026-08-28T10:00:00.000Z",
    originalSourceJson: envelope(id, "originalSourceJson", {
      type: "bug",
      problem: "Upload fails",
    }),
    currentSourceJson: envelope(id, "currentSourceJson", {
      type: "bug",
      problem: "Upload fails",
    }),
    contextJson: envelope(id, "contextJson", [
      {
        name: "version",
        value: "1.0",
        purpose: "Reproduce",
        source: "public",
        trust: "unverified",
      },
    ]),
    attachmentNamesJson: envelope(id, "attachmentNamesJson", ["trace.txt"]),
    workspaceClassification: null,
    ...overrides,
  };
}

class Tables implements AppwriteWorkbenchTablesPort {
  rows: readonly unknown[] = [];
  queries: readonly string[] = [];
  getValue: unknown = undefined;

  listRows(input: Parameters<AppwriteWorkbenchTablesPort["listRows"]>[0]) {
    this.queries = input.queries;
    return Promise.resolve({ rows: this.rows });
  }

  getRow() {
    return Promise.resolve(this.getValue);
  }
}

describe("Appwrite Workbench store", () => {
  it("BDD-WORK-001 returns a strictly scoped filtered inbox", async () => {
    const tables = new Tables();
    tables.rows = [
      row("feedback_1", { assignedMaintainerId: "maintainer_1" }),
      row("feedback_2", {
        type: "suggestion",
        state: "awaiting_reporter",
        acceptedAt: "2026-08-28T11:00:00.000Z",
      }),
    ];
    const store = createAppwriteWorkbenchStore(tables, schema, queries, sensitive);

    await expect(
      store.list({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toMatchObject([
      { feedbackId: "feedback_2", assignedPrincipalIds: [] },
      { feedbackId: "feedback_1", assignedPrincipalIds: ["maintainer_1"] },
    ]);
    expect(tables.queries).toEqual([
      "equal:workspaceId:workspace_1",
      "equal:projectId:project_1",
      "limit:100",
    ]);
  });

  it("BDD-WORK-005 decrypts only the authorized detail projection", async () => {
    const tables = new Tables();
    tables.getValue = row("feedback_1", {
      assignedMaintainerId: "maintainer_1",
      workspaceClassification: "Performance",
    });
    const store = createAppwriteWorkbenchStore(tables, schema, queries, sensitive);

    await expect(
      store.read({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).resolves.toMatchObject({
      feedbackId: "feedback_1",
      source: { type: "bug", problem: "Upload fails" },
      context: [{ name: "version", value: "1.0" }],
      attachmentNames: ["trace.txt"],
      classification: "Performance",
      assignedMaintainerId: "maintainer_1",
    });
  });

  it("BDD-WORK-002/003 fails closed for malformed, sibling and removed records", async () => {
    for (const value of [
      row("feedback_1", { workspaceId: "workspace_2" }),
      row("feedback_1", { projectId: "project_2" }),
      row("feedback_1", { type: "unknown" }),
    ]) {
      const tables = new Tables();
      tables.getValue = value;
      await expect(
        createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
          actor: owner,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
        }),
      ).rejects.toBeInstanceOf(AppwriteWorkbenchError);
    }
    const tables = new Tables();
    tables.getValue = row("feedback_1", { assignedMaintainerId: undefined });
    await expect(
      createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
        actor: {
          principalId: "maintainer_1",
          responsibility: "project_maintainer",
          workspaceIds: ["workspace_1"],
          projectIds: ["project_1"],
        },
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
  });

  it("BDD-WORK-006 rejects malformed decrypted context at the trust boundary", async () => {
    const tables = new Tables();
    tables.getValue = row("feedback_1", {
      contextJson: envelope("feedback_1", "contextJson", [
        {
          name: "version",
          value: "<script>alert(1)</script>",
          purpose: "Reproduce",
          source: "public",
          trust: "unverified",
        },
      ]),
    });

    await expect(
      createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
  });

  it("BDD-WORK-018 normalizes Appwrite UTC datetime representations", async () => {
    const tables = new Tables();
    tables.rows = [row("feedback_1", { acceptedAt: "2026-08-28T10:00:00+00:00" })];
    await expect(
      createAppwriteWorkbenchStore(tables, schema, queries, sensitive).list({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toMatchObject([{ acceptedAt: "2026-08-28T10:00:00.000Z" }]);
  });

  it("BDD-WORK-004 denies a forged actor scope before exposing detail", async () => {
    const tables = new Tables();
    tables.getValue = row("feedback_1");

    await expect(
      createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
        actor: { ...owner, workspaceIds: ["workspace_2"] },
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
  });

  it("fails closed for malformed stored rows, envelopes and adapter failures", async () => {
    expect(() =>
      createAppwriteWorkbenchStore(
        new Tables(),
        { databaseId: "bad id", feedbackTableId: "feedback_items" },
        queries,
        sensitive,
      ),
    ).toThrow("APPWRITE_WORKBENCH_SCHEMA_INVALID");
    for (const malformed of [
      row("feedback_1", { assignedMaintainerId: "bad id" }),
      row("feedback_1", { acceptedAt: "not-a-date" }),
      row("feedback_1", { acceptedAt: "2026-99-99T10:00:00Z" }),
      row("feedback_1", { acceptedAt: 1 }),
      null,
    ]) {
      const tables = new Tables();
      tables.rows = [malformed];
      await expect(
        createAppwriteWorkbenchStore(tables, schema, queries, sensitive).list({
          actor: owner,
          workspaceId: "workspace_1",
          projectId: "project_1",
          filter: { types: [], states: [], assignment: "all" },
        }),
      ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
    }
    for (const overrides of [
      { currentSourceJson: 1 },
      { currentSourceJson: "invalid-envelope" },
      { contextJson: envelope("feedback_1", "contextJson", "not-an-array") },
      {
        contextJson: envelope(
          "feedback_1",
          "contextJson",
          Array.from({ length: 21 }, () => ({})),
        ),
      },
      {
        contextJson: envelope("feedback_1", "contextJson", [
          {
            name: "version",
            value: "1",
            purpose: "Use",
            source: "public",
            trust: "unverified",
          },
          {
            name: "version",
            value: "2",
            purpose: "Use",
            source: "public",
            trust: "unverified",
          },
        ]),
      },
      { attachmentNamesJson: envelope("feedback_1", "attachmentNamesJson", [""]) },
      { workspaceClassification: 1 },
      { deletedAt: "2026-08-28T12:00:00+00:00" },
    ]) {
      const tables = new Tables();
      tables.getValue = row("feedback_1", overrides);
      await expect(
        createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
          actor: owner,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
        }),
      ).rejects.toBeInstanceOf(AppwriteWorkbenchError);
    }
    for (const candidate of [
      null,
      { name: 1, value: "x", purpose: "Use", source: "public", trust: "unverified" },
      { name: "", value: "x", purpose: "Use", source: "public", trust: "unverified" },
      {
        name: "version",
        value: "x",
        purpose: "",
        source: "public",
        trust: "unverified",
      },
      {
        name: "version",
        value: "x",
        purpose: "x".repeat(301),
        source: "public",
        trust: "unverified",
      },
      {
        name: "version",
        value: "x",
        purpose: "Use",
        source: "private",
        trust: "unverified",
      },
      {
        name: "version",
        value: "x",
        purpose: "Use",
        source: "public",
        trust: "trusted",
      },
      {
        name: "version",
        value: {},
        purpose: "Use",
        source: "public",
        trust: "unverified",
      },
      {
        name: "version",
        value: "x".repeat(501),
        purpose: "Use",
        source: "public",
        trust: "unverified",
      },
      {
        name: "version",
        value: "<script>x</script>",
        purpose: "Use",
        source: "public",
        trust: "unverified",
      },
      {
        name: "version",
        value: Number.NaN,
        purpose: "Use",
        source: "public",
        trust: "unverified",
      },
    ]) {
      const tables = new Tables();
      tables.getValue = row("feedback_1", {
        contextJson: envelope("feedback_1", "contextJson", [candidate]),
      });
      await expect(
        createAppwriteWorkbenchStore(tables, schema, queries, sensitive).read({
          actor: owner,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
        }),
      ).rejects.toBeInstanceOf(AppwriteWorkbenchError);
    }
    const optionalProjection = new Tables();
    optionalProjection.getValue = row("feedback_1", {
      contextJson: envelope("feedback_1", "contextJson", [
        {
          name: "version",
          value: "1.0",
          purpose: "Reproduce",
          source: "public",
          trust: "unverified",
        },
        {
          name: "retryCount",
          value: 2,
          purpose: "Diagnose",
          source: "system_observed",
          trust: "verified",
        },
        {
          name: "offline",
          value: false,
          purpose: "Diagnose",
          source: "client_assertion",
          trust: "unverified",
        },
      ]),
    });
    await expect(
      createAppwriteWorkbenchStore(optionalProjection, schema, queries, sensitive).read(
        {
          actor: owner,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
        },
      ),
    ).resolves.toMatchObject({ classification: null, assignedMaintainerId: null });
    const listFailure = new Tables();
    vi.spyOn(listFailure, "listRows").mockRejectedValueOnce(new Error("transport"));
    await expect(
      createAppwriteWorkbenchStore(listFailure, schema, queries, sensitive).list({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
    const readFailure = new Tables();
    vi.spyOn(readFailure, "getRow").mockRejectedValueOnce(new Error("transport"));
    await expect(
      createAppwriteWorkbenchStore(readFailure, schema, queries, sensitive).read({
        actor: owner,
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).rejects.toEqual(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
  });
});
