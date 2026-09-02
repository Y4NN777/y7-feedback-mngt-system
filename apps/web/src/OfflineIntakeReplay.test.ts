import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { createOfflineIntakePersistence } from "./OfflineIntake";
import { createOfflineIntakeReplay } from "./OfflineIntakeReplay";
import { createIndexedDbOfflineStore } from "./OfflineStore";

const command = {
  projectSlug: "wisemoney",
  clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
  locale: "fr" as const,
  draft: {
    projectId: "project_wisemoney",
    workspaceId: "workspace_public",
    type: "bug" as const,
    originalSource: { type: "bug" as const, problem: "A deterministic problem" },
    reporter: { kind: "unidentified" as const },
    context: [],
    attachmentNames: [],
    derivedClassification: null,
  },
};

describe("offline intake replay adapter", () => {
  it("BDD-OFF-209 returns authoritative acceptance once and removes the operation", async () => {
    const store = createIndexedDbOfflineStore({
      databaseName: `offline-replay-${crypto.randomUUID()}`,
      now: () => "2026-09-02T04:00:00.000Z",
    });
    await createOfflineIntakePersistence(store, "preview").queue(command);
    const accept = vi.fn(() =>
      Promise.resolve({
        status: "accepted" as const,
        reference: "Y7-2026-000001",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: false,
      }),
    );
    const replay = createOfflineIntakeReplay({
      store,
      environment: "preview",
      gateway: { accept },
      probe: () => Promise.resolve(true),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(replay.runOnce("wisemoney")).resolves.toMatchObject({
      status: "accepted",
      outcome: { reference: "Y7-2026-000001" },
    });
    await expect(replay.runOnce("wisemoney")).resolves.toEqual({ status: "idle" });
    expect(accept).toHaveBeenCalledOnce();
    await store.close();
  });

  it("BDD-OFF-210 preserves Retry-After and makes invalid server outcomes terminal", async () => {
    const retryStore = createIndexedDbOfflineStore({
      databaseName: `offline-retry-${crypto.randomUUID()}`,
      now: () => "2026-09-02T04:00:00.000Z",
    });
    await createOfflineIntakePersistence(retryStore, "preview").queue(command);
    const retry = createOfflineIntakeReplay({
      store: retryStore,
      environment: "preview",
      gateway: {
        accept: () => Promise.resolve({ status: "retryable", retryAfterMs: 45_000 }),
      },
      probe: () => Promise.resolve(true),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(retry.runOnce("wisemoney")).resolves.toEqual({
      status: "retry_scheduled",
    });
    await retryStore.close();

    const invalidStore = createIndexedDbOfflineStore({
      databaseName: `offline-invalid-${crypto.randomUUID()}`,
      now: () => "2026-09-02T04:00:00.000Z",
    });
    await createOfflineIntakePersistence(invalidStore, "preview").queue(command);
    const invalid = createOfflineIntakeReplay({
      store: invalidStore,
      environment: "preview",
      gateway: { accept: () => Promise.resolve({ status: "invalid" }) },
      probe: () => Promise.resolve(true),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(invalid.runOnce("wisemoney")).resolves.toEqual({
      status: "conflict",
      operationId: command.clientOperationId,
    });
    await invalidStore.close();
  });
});
