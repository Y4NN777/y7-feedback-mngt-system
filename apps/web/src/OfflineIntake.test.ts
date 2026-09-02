import { describe, expect, it, vi } from "vitest";

import type { DraftFields } from "./FeedbackIntake";
import { createOfflineIntakePersistence } from "./OfflineIntake";
import type { OfflineOperationInput, OfflineScope } from "./OfflineStore";

const completeDraft: DraftFields = {
  appreciation: "",
  contact: "person@example.test",
  expected: "",
  experience: "",
  observed: "",
  problem: "A deterministic problem",
  proposal: "",
  rationale: "",
  reproduction: "",
  type: "bug",
  usageContext: "",
  version: "2.0.0",
};

function store() {
  return {
    loadDraft: vi.fn((_scope: OfflineScope, _id: string) => {
      void _scope;
      void _id;
      return Promise.resolve<{
        readonly payload: Readonly<Record<string, unknown>>;
      } | null>(null);
    }),
    saveDraft: vi.fn(
      (
        _scope: OfflineScope,
        _id: string,
        _payload: Readonly<Record<string, unknown>>,
      ) => {
        void _scope;
        void _id;
        void _payload;
        return Promise.resolve({});
      },
    ),
    deleteDraft: vi.fn((_scope: OfflineScope, _id: string) => {
      void _scope;
      void _id;
      return Promise.resolve();
    }),
    enqueue: vi.fn((_scope: OfflineScope, _operation: OfflineOperationInput) => {
      void _scope;
      void _operation;
      return Promise.resolve({});
    }),
  };
}

describe("offline intake persistence", () => {
  it("BDD-OFF-101 restores only a complete validated draft from its exact scope", async () => {
    const adapter = store();
    adapter.loadDraft.mockResolvedValue({ payload: { ...completeDraft } });
    const persistence = createOfflineIntakePersistence(adapter, "preview");
    await expect(persistence.restore("wisemoney")).resolves.toEqual(completeDraft);
    expect(adapter.loadDraft).toHaveBeenCalledWith(
      {
        environment: "preview",
        workspaceId: "public_projection",
        projectId: "wisemoney",
        actorId: "accountless_reporter",
      },
      "intake",
    );
    adapter.loadDraft.mockResolvedValue({
      payload: { ...completeDraft, type: "invented" },
    });
    await expect(persistence.restore("wisemoney")).resolves.toBeNull();
  });

  it("BDD-OFF-102 saves and erases the draft only in the selected Project partition", async () => {
    const adapter = store();
    const persistence = createOfflineIntakePersistence(adapter, "development");
    await persistence.save("wisemoney", completeDraft);
    await persistence.clear("wisemoney");
    const exactScope = {
      environment: "development" as const,
      workspaceId: "public_projection",
      projectId: "wisemoney",
      actorId: "accountless_reporter",
    };
    expect(adapter.saveDraft).toHaveBeenCalledWith(exactScope, "intake", completeDraft);
    expect(adapter.deleteDraft).toHaveBeenCalledWith(exactScope, "intake");
  });

  it("BDD-OFF-103 queues one digest-bound operation without persisting an access proof", async () => {
    const adapter = store();
    const persistence = createOfflineIntakePersistence(adapter, "preview");
    const command = {
      projectSlug: "wisemoney",
      clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
      locale: "fr" as const,
      draft: {
        projectId: "project_wisemoney",
        workspaceId: "workspace_public",
        type: "bug" as const,
        originalSource: {
          type: "bug" as const,
          problem: "A deterministic problem",
        },
        reporter: { kind: "unidentified" as const },
        context: [],
        attachmentNames: [],
        derivedClassification: null,
      },
    };
    await persistence.queue(command);
    expect(adapter.enqueue).toHaveBeenCalledOnce();
    const call = adapter.enqueue.mock.calls[0];
    expect(call?.[0]).toMatchObject({
      environment: "preview",
      projectId: "wisemoney",
    });
    expect(call?.[1]).toMatchObject({
      clientOperationId: command.clientOperationId,
      kind: "intake",
      payload: { command },
      dependencies: [],
    });
    expect(call?.[1].payloadDigest).toMatch(/^sha256_[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(adapter.enqueue.mock.calls)).not.toMatch(
      /accessProof|authorization|token/iu,
    );
  });
});
