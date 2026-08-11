import { describe, expect, it, vi } from "vitest";

import type { ReporterFeedbackRecord } from "@y7-feedback/domain";

import {
  createAppwriteAccountlessRepository,
  createNodeAppwriteAccountlessRepository,
  type AppwriteAccountlessQueryPort,
  type AppwriteAccountlessTablesPort,
} from "./appwrite-accountless-repository";

const schema = {
  databaseId: "feedback",
  accessGrantsTableId: "access_grants",
  feedbackTableId: "feedback",
};

const grantRow = {
  $id: "feedback-1",
  feedbackId: "feedback-1",
  reference: "Y7-2026-000001",
  verifier: "sha256:verifier",
  generation: 1,
  status: "active",
};

const feedbackRow = {
  $id: "feedback-1",
  originalSourceJson: JSON.stringify({ type: "bug", problem: "Broken balance" }),
  currentSourceJson: JSON.stringify({ type: "bug", problem: "Broken balance" }),
  state: "received",
  reporterHistoryJson: "[]",
  reporterMessagesJson: "[]",
  reporterAttachmentsJson: "[]",
  sourceRevisionsJson: "[]",
  deletionRequestsJson: "[]",
  internalNotesJson: "[]",
  workspaceClassification: null,
};

const populatedFeedbackRow = {
  ...feedbackRow,
  originalSourceJson: JSON.stringify({
    type: "bug",
    problem: "Broken balance",
    expectedBehavior: "Fresh balance",
    observedBehavior: "Stale balance",
    reproductionSteps: "Open dashboard",
  }),
  currentSourceJson: JSON.stringify({
    type: "suggestion",
    proposal: "Add refresh",
    rationale: "Avoid stale state",
    usageContext: "Dashboard",
  }),
  state: "awaiting_reporter",
  reporterHistoryJson: JSON.stringify([
    {
      id: "history-1",
      kind: "state_changed",
      audience: "reporter",
      actor: "system",
      occurredAt: "2026-08-10T12:00:00.000Z",
      detail: "Need clarification",
    },
  ]),
  reporterMessagesJson: JSON.stringify([
    {
      id: "message-1",
      audience: "workspace",
      actor: "maintainer-1",
      occurredAt: "2026-08-10T12:01:00.000Z",
      content: "Please clarify",
    },
  ]),
  reporterAttachmentsJson: JSON.stringify([
    { id: "attachment-1", audience: "reporter", name: "evidence.png" },
  ]),
  sourceRevisionsJson: JSON.stringify([
    {
      id: "revision-1",
      priorSource: {
        type: "review",
        experience: "Slow",
        appreciation: "Clear",
      },
      source: { type: "bug", problem: "Updated issue" },
      actor: "reporter",
      occurredAt: "2026-08-10T12:02:00.000Z",
    },
  ]),
  deletionRequestsJson: JSON.stringify([
    {
      id: "deletion-1",
      status: "received",
      reason: "No longer needed",
      actor: "reporter",
      occurredAt: "2026-08-10T12:03:00.000Z",
    },
  ]),
  internalNotesJson: '["internal"]',
  workspaceClassification: "triage",
};

function setup(
  grants: readonly unknown[] = [grantRow],
  feedback: unknown = feedbackRow,
) {
  const listRows = vi.fn(() => Promise.resolve({ rows: grants }));
  const getRow = vi.fn(() => Promise.resolve(feedback));
  const updateRow = vi.fn(() => Promise.resolve({}));
  const tables: AppwriteAccountlessTablesPort = { listRows, getRow, updateRow };
  const queries: AppwriteAccountlessQueryPort = {
    equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
    limit: (limit) => `limit:${String(limit)}`,
  };
  return {
    getRow,
    listRows,
    repository: createAppwriteAccountlessRepository(tables, schema, queries),
    updateRow,
  };
}

function record(): ReporterFeedbackRecord {
  return {
    feedbackId: "feedback-1",
    reference: "Y7-2026-000001",
    originalSource: { type: "bug", problem: "Broken balance" },
    currentSource: { type: "bug", problem: "Updated detail" },
    currentState: "awaiting_reporter",
    history: [
      {
        id: "history-1",
        kind: "state_changed",
        audience: "reporter",
        actor: "system",
        occurredAt: "2026-08-10T12:00:00.000Z",
        detail: "Need clarification",
      },
    ],
    messages: [],
    attachments: [],
    sourceRevisions: [],
    deletionRequests: [],
    internalNotes: ["must-not-be-written-by-reporter-capability"],
    workspaceClassification: "internal-only",
  };
}

describe("Appwrite accountless access repository", () => {
  it("BDD-ACC-APPWRITE-001 resolves one grant and its exact Feedback", async () => {
    const { repository, listRows, getRow } = setup();

    await expect(repository.loadByReference("Y7-2026-000001")).resolves.toEqual({
      grant: {
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        verifier: "sha256:verifier",
        generation: 1,
        status: "active",
      },
      record: {
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        originalSource: { type: "bug", problem: "Broken balance" },
        currentSource: { type: "bug", problem: "Broken balance" },
        currentState: "received",
        history: [],
        messages: [],
        attachments: [],
        sourceRevisions: [],
        deletionRequests: [],
        internalNotes: [],
        workspaceClassification: null,
      },
    });
    expect(listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "access_grants",
      queries: ["equal:reference:Y7-2026-000001", "limit:2"],
      total: false,
      ttl: 0,
    });
    expect(getRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback",
      rowId: "feedback-1",
    });
  });

  it("returns null for an absent reference and fails closed for duplicates", async () => {
    await expect(setup([]).repository.loadByReference("unknown")).resolves.toBeNull();
    await expect(
      setup([grantRow, { ...grantRow }]).repository.loadByReference("Y7-2026-000001"),
    ).rejects.toThrow("APPWRITE_ACCOUNTLESS_INCONSISTENT");
  });

  it("parses every bounded Reporter projection collection", async () => {
    const resource = await setup(
      [grantRow],
      populatedFeedbackRow,
    ).repository.loadByReference("Y7-2026-000001");
    expect(resource?.record).toMatchObject({
      currentState: "awaiting_reporter",
      currentSource: { type: "suggestion", usageContext: "Dashboard" },
      history: [{ audience: "reporter" }],
      messages: [{ audience: "workspace" }],
      attachments: [{ name: "evidence.png" }],
      sourceRevisions: [{ priorSource: { type: "review" }, source: { type: "bug" } }],
      deletionRequests: [{ status: "received" }],
      internalNotes: ["internal"],
      workspaceClassification: "triage",
    });

    await expect(
      setup(
        [{ ...grantRow, status: "revoked" }],
        feedbackRow,
      ).repository.loadByReference("Y7-2026-000001"),
    ).resolves.toMatchObject({ grant: { status: "revoked" } });
    await expect(
      setup([grantRow], {
        ...feedbackRow,
        currentSourceJson: JSON.stringify({
          type: "suggestion",
          proposal: "Export",
          rationale: "Reporting",
        }),
      }).repository.loadByReference("Y7-2026-000001"),
    ).resolves.toMatchObject({ record: { currentSource: { type: "suggestion" } } });
  });

  it("rejects malformed or cross-linked rows", async () => {
    const cases: readonly [readonly unknown[], unknown][] = [
      [[null], feedbackRow],
      [[{ ...grantRow, feedbackId: "feedback-2" }], feedbackRow],
      [[{ ...grantRow, generation: "1" }], feedbackRow],
      [[{ ...grantRow, generation: 1.5 }], feedbackRow],
      [[{ ...grantRow, generation: 0 }], feedbackRow],
      [[{ ...grantRow, status: "expired" }], feedbackRow],
      [[grantRow], null],
      [[grantRow], { ...feedbackRow, $id: "feedback-2" }],
      [[grantRow], { ...feedbackRow, originalSourceJson: "not-json" }],
      [[grantRow], { ...feedbackRow, originalSourceJson: "null" }],
      [
        [grantRow],
        {
          ...feedbackRow,
          originalSourceJson: JSON.stringify({ type: "bug", problem: " " }),
        },
      ],
      [
        [grantRow],
        {
          ...feedbackRow,
          originalSourceJson: JSON.stringify({ type: "unknown" }),
        },
      ],
      [[grantRow], { ...feedbackRow, state: "secret" }],
      [[grantRow], { ...feedbackRow, reporterHistoryJson: "{}" }],
      [[grantRow], { ...feedbackRow, reporterHistoryJson: "[null]" }],
      [
        [grantRow],
        {
          ...feedbackRow,
          reporterHistoryJson: JSON.stringify([
            {
              id: "history",
              kind: "event",
              audience: "private",
              actor: "actor",
              occurredAt: "now",
              detail: "detail",
            },
          ]),
        },
      ],
      [[grantRow], { ...feedbackRow, reporterMessagesJson: "[null]" }],
      [[grantRow], { ...feedbackRow, reporterAttachmentsJson: "[null]" }],
      [[grantRow], { ...feedbackRow, sourceRevisionsJson: "[null]" }],
      [
        [grantRow],
        {
          ...feedbackRow,
          sourceRevisionsJson: JSON.stringify([
            {
              id: "revision",
              priorSource: null,
              source: null,
              actor: "actor",
              occurredAt: "now",
            },
          ]),
        },
      ],
      [[grantRow], { ...feedbackRow, deletionRequestsJson: "[null]" }],
      [
        [grantRow],
        {
          ...feedbackRow,
          deletionRequestsJson: JSON.stringify([{ status: "done" }]),
        },
      ],
      [[grantRow], { ...feedbackRow, internalNotesJson: "[null]" }],
      [[grantRow], { ...feedbackRow, workspaceClassification: 42 }],
    ];
    for (const [grants, feedback] of cases) {
      await expect(
        setup(grants, feedback).repository.loadByReference("Y7-2026-000001"),
      ).rejects.toThrow("APPWRITE_ACCOUNTLESS_ROW_INVALID");
    }

    await expect(setup().repository.loadByReference(" ")).rejects.toThrow(
      "APPWRITE_ACCOUNTLESS_ROW_INVALID",
    );
    await expect(setup().repository.loadByReference("x".repeat(101))).rejects.toThrow(
      "APPWRITE_ACCOUNTLESS_ROW_INVALID",
    );
  });

  it("updates grants and only Reporter-owned record fields", async () => {
    const { repository, updateRow } = setup();

    await repository.saveGrant({ ...grantRow, generation: 2, status: "revoked" });
    await repository.saveRecord(record());

    expect(updateRow).toHaveBeenNthCalledWith(1, {
      databaseId: "feedback",
      tableId: "access_grants",
      rowId: "feedback-1",
      data: {
        reference: "Y7-2026-000001",
        verifier: "sha256:verifier",
        generation: 2,
        status: "revoked",
      },
    });
    expect(updateRow).toHaveBeenNthCalledWith(2, {
      databaseId: "feedback",
      tableId: "feedback",
      rowId: "feedback-1",
      data: {
        currentSourceJson: JSON.stringify({
          type: "bug",
          problem: "Updated detail",
        }),
        state: "awaiting_reporter",
        reporterHistoryJson: JSON.stringify(record().history),
        reporterMessagesJson: "[]",
        reporterAttachmentsJson: "[]",
        sourceRevisionsJson: "[]",
        deletionRequestsJson: "[]",
      },
    });
    expect(JSON.stringify(updateRow.mock.calls)).not.toContain("internal-only");
    expect(JSON.stringify(updateRow.mock.calls)).not.toContain("must-not-be-written");
  });

  it("validates schema and uses the real Node query adapter", async () => {
    expect(() =>
      createAppwriteAccountlessRepository(
        setup().repository as unknown as AppwriteAccountlessTablesPort,
        { ...schema, feedbackTableId: schema.accessGrantsTableId },
        { equal: () => "query", limit: () => "limit" },
      ),
    ).toThrow("APPWRITE_ACCOUNTLESS_SCHEMA_INVALID");
    expect(() =>
      createAppwriteAccountlessRepository(
        {
          listRows: vi.fn(),
          getRow: vi.fn(),
          updateRow: vi.fn(),
        },
        { ...schema, databaseId: "bad/id" },
        { equal: () => "query", limit: () => "limit" },
      ),
    ).toThrow("APPWRITE_ACCOUNTLESS_SCHEMA_INVALID");

    const listRows = vi.fn(() => Promise.resolve({ rows: [grantRow] }));
    const getRow = vi.fn(() => Promise.resolve(feedbackRow));
    const updateRow = vi.fn(() => Promise.resolve({}));
    const repository = createNodeAppwriteAccountlessRepository(
      {
        listRows,
        getRow,
        updateRow,
      } as unknown as import("node-appwrite").TablesDB,
      schema,
    );
    await expect(repository.loadByReference("Y7-2026-000001")).resolves.toMatchObject({
      grant: { feedbackId: "feedback-1" },
    });
    await repository.saveGrant({
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      verifier: "sha256:verifier",
      generation: 1,
      status: "active",
    });
    await repository.saveRecord(record());
    expect(getRow).toHaveBeenCalledOnce();
    expect(updateRow).toHaveBeenCalledTimes(2);
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [expect.any(String), expect.any(String)] }),
    );
  });
});
