import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteIntelligenceStore,
  type AppwriteIntelligenceTables,
} from "./appwrite-intelligence-store";

const schema = {
  databaseId: "feedback_preview",
  feedbackTableId: "feedback_items",
  reportersTableId: "reporters",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const sensitive = {
  environment: "preview",
  protector: {
    seal: () => "unused",
    open: (_context: unknown, envelope: string) => envelope,
  },
};

function reporter(
  id: string,
  kind: "unidentified" | "contact" | "external" | "assertion" = "unidentified",
) {
  return {
    $id: id,
    workspaceId: "workspace_1",
    attributionJson: JSON.stringify({ kind }),
  };
}

function feedback(input: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    reporterId: "reporter_1",
    type: "bug",
    state: "received",
    acceptedAt: "2026-08-10T12:00:00.000Z",
    contextJson: JSON.stringify([
      {
        name: "applicationVersion",
        value: "2.0.0",
        trust: "verified",
      },
      { name: "place", value: "dashboard", trust: "verified" },
      { name: "feature", value: "balance", trust: "verified" },
      { name: "privateHint", value: "ignored", trust: "unverified" },
    ]),
    deletedAt: null,
    ...input,
  };
}

function setup(input: {
  readonly feedback?: readonly unknown[];
  readonly reporters?: readonly unknown[];
}) {
  const listRows = vi.fn<AppwriteIntelligenceTables["listRows"]>((request) =>
    Promise.resolve({
      rows:
        request.tableId === schema.feedbackTableId
          ? (input.feedback ?? [feedback()])
          : (input.reporters ?? [reporter("reporter_1")]),
    }),
  );
  return {
    listRows,
    store: createAppwriteIntelligenceStore({ listRows }, schema, queries, sensitive),
  };
}

describe("Appwrite Intelligence store", () => {
  it("BDD-INT-201 reads only exact scope and exposes reviewed context dimensions", async () => {
    const target = setup({});
    await expect(
      target.store.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual([
      {
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        type: "bug",
        state: "received",
        createdAt: "2026-08-10T12:00:00.000Z",
        reporterKind: "unidentified",
        version: "2.0.0",
        place: "dashboard",
        feature: "balance",
        context: [
          { name: "applicationVersion", value: "2.0.0", reviewed: true },
          { name: "place", value: "dashboard", reviewed: true },
          { name: "feature", value: "balance", reviewed: true },
          { name: "privateHint", value: "ignored", reviewed: false },
        ],
      },
    ]);
    expect(target.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "feedback_items",
        queries: [
          "equal:workspaceId:workspace_1",
          "equal:projectId:project_1",
          "limit:5000",
        ],
      }),
    );
    expect(target.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "reporters",
        queries: ["equal:workspaceId:workspace_1", "limit:5000"],
      }),
    );
  });

  it("BDD-INT-201 normalizes Appwrite UTC offset timestamps", async () => {
    const { store } = setup({
      feedback: [feedback({ acceptedAt: "2026-08-10T12:00:00.000+00:00" })],
    });

    await expect(
      store.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual([
      expect.objectContaining({ createdAt: "2026-08-10T12:00:00.000Z" }),
    ]);
  });

  it("BDD-INT-202 maps contact and verified provider assertions without identifiers", async () => {
    const target = setup({
      reporters: [
        reporter("reporter_contact", "contact"),
        reporter("reporter_external", "external"),
        reporter("reporter_assertion", "assertion"),
      ],
      feedback: [
        feedback({ $id: "feedback_contact", reporterId: "reporter_contact" }),
        feedback({ $id: "feedback_external", reporterId: "reporter_external" }),
        feedback({ $id: "feedback_assertion", reporterId: "reporter_assertion" }),
      ],
    });
    const result = await target.store.list({
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    expect(result.map(({ reporterKind }) => reporterKind)).toEqual([
      "contact",
      "external",
      "external",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/issuer|applicationId|@/u);
  });

  it("BDD-INT-203 retains only a deletion timestamp and omits unreviewed dimensions", async () => {
    const target = setup({
      feedback: [
        feedback({
          deletedAt: "2026-08-11T12:00:00.000Z",
          contextJson: JSON.stringify([
            { name: "feature", value: "secret", trust: "unverified" },
          ]),
        }),
      ],
    });
    await expect(
      target.store.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        deletedAt: "2026-08-11T12:00:00.000Z",
        context: [{ name: "feature", value: "secret", reviewed: false }],
      }),
    ]);
    const [result] = await target.store.list({
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    expect(result).not.toHaveProperty("feature");
    expect(result).not.toHaveProperty("version");
    expect(result).not.toHaveProperty("place");
  });

  it("BDD-INT-204 fails closed for malformed scope, schema and persisted rows", async () => {
    expect(() =>
      createAppwriteIntelligenceStore(
        { listRows: vi.fn() },
        { ...schema, feedbackTableId: "bad id" },
        queries,
        sensitive,
      ),
    ).toThrow("APPWRITE_INTELLIGENCE_SCHEMA_INVALID");
    for (const invalidSchema of [
      { ...schema, databaseId: "bad id" },
      { ...schema, reportersTableId: "bad id" },
    ]) {
      expect(() =>
        createAppwriteIntelligenceStore(
          { listRows: vi.fn() },
          invalidSchema,
          queries,
          sensitive,
        ),
      ).toThrow("APPWRITE_INTELLIGENCE_SCHEMA_INVALID");
    }
    await expect(
      setup({}).store.list({ workspaceId: "bad id", projectId: "project_1" }),
    ).rejects.toThrow("APPWRITE_INTELLIGENCE_SCOPE_INVALID");

    for (const malformed of [
      null,
      feedback({ $id: "bad id" }),
      feedback({ workspaceId: "workspace_2" }),
      feedback({ projectId: "project_2" }),
      feedback({ reporterId: null }),
      feedback({ type: "invented" }),
      feedback({ state: "invented" }),
      feedback({ reporterId: "missing" }),
      feedback({ acceptedAt: "invalid" }),
      feedback({ acceptedAt: "invalidZ" }),
      feedback({ contextJson: null }),
      feedback({ contextJson: "invalid-json" }),
      feedback({ contextJson: JSON.stringify({}) }),
      feedback({ contextJson: JSON.stringify(Array.from({ length: 21 }, () => ({}))) }),
      feedback({ contextJson: JSON.stringify([null]) }),
      feedback({ contextJson: JSON.stringify([42]) }),
      feedback({ contextJson: JSON.stringify([[]]) }),
      feedback({
        contextJson: JSON.stringify([
          { name: "bad name", value: "x", trust: "verified" },
        ]),
      }),
      feedback({
        contextJson: JSON.stringify([
          { name: "valid", value: null, trust: "verified" },
        ]),
      }),
      feedback({
        contextJson: '[{"name":"valid","value":1e999,"trust":"verified"}]',
      }),
      feedback({
        contextJson: JSON.stringify([{ name: "valid", value: "x", trust: "invented" }]),
      }),
    ]) {
      await expect(
        setup({ feedback: [malformed] }).store.list({
          workspaceId: "workspace_1",
          projectId: "project_1",
        }),
      ).rejects.toThrow("APPWRITE_INTELLIGENCE_UNAVAILABLE");
    }
    for (const malformed of [
      null,
      reporter("bad id"),
      { ...reporter("reporter_1"), workspaceId: "workspace_2" },
      { ...reporter("reporter_1"), attributionJson: "invalid-json" },
      { ...reporter("reporter_1"), attributionJson: null },
      { ...reporter("reporter_1"), attributionJson: JSON.stringify({}) },
      { ...reporter("reporter_1"), attributionJson: JSON.stringify({ kind: "bad" }) },
    ]) {
      await expect(
        setup({ reporters: [malformed] }).store.list({
          workspaceId: "workspace_1",
          projectId: "project_1",
        }),
      ).rejects.toThrow("APPWRITE_INTELLIGENCE_UNAVAILABLE");
    }
  });

  it("BDD-INT-205 reduces Appwrite failure to a stable unavailable error", async () => {
    const store = createAppwriteIntelligenceStore(
      {
        listRows: () => Promise.reject(new Error("transport details")),
      },
      schema,
      queries,
      sensitive,
    );
    await expect(
      store.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).rejects.toEqual(new Error("APPWRITE_INTELLIGENCE_UNAVAILABLE"));
  });
});
