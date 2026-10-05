import { describe, expect, it } from "vitest";

import type { AttachmentRecord } from "@y7-feedback/domain";

import type {
  AttachmentAcceptanceStore,
  AttachmentSagaDependencies,
  PrivateAttachmentStorage,
  StagedAttachmentObject,
} from "./attachment-saga";
import { createAttachmentSaga } from "./attachment-saga";

const operationId = "123e4567-e89b-42d3-a456-426614174000";
const encoder = new TextEncoder();

function file(name: string) {
  return {
    bytes: encoder.encode(`safe:${name}`),
    clientName: name,
    clientMediaType: "text/plain",
  };
}

class MemoryStorage implements PrivateAttachmentStorage {
  readonly staged = new Map<string, StagedAttachmentObject>();
  readonly stageCalls: string[] = [];
  readonly removeCalls: string[] = [];
  failStageAt = 0;
  failRemoveOnceFor: string | undefined;

  stage(input: {
    readonly objectId: string;
    readonly operationId: string;
    readonly stagedAt: string;
    readonly bytes: Uint8Array;
    readonly visibility: "private";
  }): Promise<void> {
    this.stageCalls.push(input.objectId);
    expect(input.visibility).toBe("private");
    if (this.failStageAt === this.stageCalls.length) {
      return Promise.reject(new Error("storage down"));
    }
    this.staged.set(input.objectId, {
      objectId: input.objectId,
      operationId: input.operationId,
      stagedAt: input.stagedAt,
    });
    return Promise.resolve();
  }

  remove(objectId: string): Promise<void> {
    this.removeCalls.push(objectId);
    if (this.failRemoveOnceFor === objectId) {
      this.failRemoveOnceFor = undefined;
      return Promise.reject(new Error("cleanup down"));
    }
    this.staged.delete(objectId);
    return Promise.resolve();
  }

  listStagedBefore(before: string): Promise<readonly StagedAttachmentObject[]> {
    return Promise.resolve(
      [...this.staged.values()].filter((item) => item.stagedAt < before),
    );
  }
}

class MemoryStore implements AttachmentAcceptanceStore {
  readonly associated = new Set<string>();
  commits: readonly (readonly AttachmentRecord[])[] = [];
  failCommit = false;

  commit(input: {
    readonly operationId: string;
    readonly feedbackId: string;
    readonly attachments: readonly AttachmentRecord[];
  }): Promise<void> {
    if (this.failCommit) return Promise.reject(new Error("database down"));
    this.commits = [...this.commits, input.attachments];
    for (const attachment of input.attachments) {
      this.associated.add(attachment.objectId);
    }
    return Promise.resolve();
  }

  isObjectAssociated(objectId: string): Promise<boolean> {
    return Promise.resolve(this.associated.has(objectId));
  }
}

function setup() {
  const storage = new MemoryStorage();
  const store = new MemoryStore();
  let attachmentSequence = 0;
  let objectSequence = 0;
  const dependencies: AttachmentSagaDependencies = {
    now: () => "2026-08-10T17:00:00.000Z",
    createAttachmentId: () => `attachment-${String(++attachmentSequence)}`,
    createObjectId: () => `private/object-${String(++objectSequence)}`,
    validate: (candidate) =>
      Promise.resolve({
        status: "accepted",
        metadata: {
          format: "txt",
          mediaType: "text/plain; charset=utf-8",
          size: candidate.bytes.byteLength,
          sha256: `digest_${candidate.clientName.replaceAll(".", "_")}`,
          displayName: candidate.clientName,
        },
      }),
  };
  const saga = createAttachmentSaga(storage, store, dependencies);
  const command = {
    operationId,
    feedbackId: "feedback-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    audience: "reporter" as const,
    sourceEntry: { kind: "source_submission" as const, id: "source-1" },
    files: [file("evidence.txt")],
  };
  return { command, dependencies, saga, storage, store };
}

describe("private Attachment acceptance saga", () => {
  it("BDD-ATT-001 accepts exactly five private files only after one metadata commit", async () => {
    const { command, saga, storage, store } = setup();
    const outcome = await saga.accept({
      ...command,
      files: Array.from({ length: 5 }, (_, index) =>
        file(`evidence-${String(index)}.txt`),
      ),
    });

    expect(outcome).toEqual({
      status: "accepted",
      feedbackId: "feedback-1",
      attachmentIds: [
        "attachment-1",
        "attachment-2",
        "attachment-3",
        "attachment-4",
        "attachment-5",
      ],
    });
    expect(storage.stageCalls).toHaveLength(5);
    expect(storage.removeCalls).toEqual([]);
    expect(store.commits).toHaveLength(1);
    expect(store.commits[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feedbackId: "feedback-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          audience: "reporter",
          lifecycle: "available",
          objectId: "private/object-1",
        }),
      ]),
    );
  });

  it("BDD-ATT-002 rejects a sixth file before staging anything", async () => {
    const { command, saga, storage, store } = setup();
    const outcome = await saga.accept({
      ...command,
      files: Array.from({ length: 6 }, (_, index) => file(`${String(index)}.txt`)),
    });

    expect(outcome).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    expect(storage.stageCalls).toEqual([]);
    expect(store.commits).toEqual([]);
  });

  it("binds internal-note evidence to the Workspace audience", async () => {
    const { command, saga, store } = setup();

    await expect(
      saga.accept({
        ...command,
        audience: "workspace",
        sourceEntry: { kind: "internal_note", id: "note-1" },
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(store.commits[0]?.[0]).toMatchObject({
      audience: "workspace",
      sourceEntry: { kind: "internal_note", id: "note-1" },
    });
  });

  it("BDD-ATT-003 removes every operation-owned object when a later file is rejected", async () => {
    const { command, dependencies, storage, store } = setup();
    const saga = createAttachmentSaga(storage, store, {
      ...dependencies,
      validate: (candidate) =>
        candidate.clientName === "bad.txt"
          ? Promise.resolve({
              status: "rejected" as const,
              code: "ATTACHMENT_REJECTED" as const,
            })
          : dependencies.validate(candidate),
    });

    const outcome = await saga.accept({
      ...command,
      files: [file("safe.txt"), file("bad.txt")],
    });

    expect(outcome).toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    expect(storage.removeCalls).toEqual(["private/object-1", "private/object-2"]);
    expect(storage.staged.size).toBe(0);
    expect(store.commits).toEqual([]);
  });

  it("maps scanner unavailability to a retryable outcome after cleanup", async () => {
    const { command, dependencies, storage, store } = setup();
    const saga = createAttachmentSaga(storage, store, {
      ...dependencies,
      validate: () =>
        Promise.resolve({
          status: "retryable",
          code: "VALIDATION_UNAVAILABLE",
        }),
    });

    await expect(saga.accept(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });
    expect(storage.staged.size).toBe(0);
    expect(store.commits).toEqual([]);
  });

  it("cleans intended objects after staging or metadata commit failures", async () => {
    const first = setup();
    first.storage.failStageAt = 2;
    await expect(
      first.saga.accept({
        ...first.command,
        files: [file("one.txt"), file("two.txt")],
      }),
    ).resolves.toEqual({ status: "retryable", code: "ATTACHMENT_UNAVAILABLE" });
    expect(first.storage.removeCalls).toEqual(["private/object-1", "private/object-2"]);
    expect(first.store.commits).toEqual([]);

    const second = setup();
    second.store.failCommit = true;
    await expect(second.saga.accept(second.command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });
    expect(second.storage.removeCalls).toEqual(["private/object-1"]);
    expect(second.store.commits).toEqual([]);
  });

  it("contains invalid generated identifiers and cleans earlier staging", async () => {
    const { command, dependencies, storage, store } = setup();
    const saga = createAttachmentSaga(storage, store, {
      ...dependencies,
      createAttachmentId: () => "attachment-duplicate",
    });

    await expect(
      saga.accept({
        ...command,
        files: [file("one.txt"), file("two.txt")],
      }),
    ).resolves.toEqual({ status: "retryable", code: "ATTACHMENT_UNAVAILABLE" });
    expect(storage.removeCalls).toEqual(["private/object-1"]);
    expect(store.commits).toEqual([]);
  });

  it("returns no success material when cleanup fails and lets the sweeper recover", async () => {
    const { command, saga, storage, store } = setup();
    store.failCommit = true;
    storage.failRemoveOnceFor = "private/object-1";

    await expect(saga.accept(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });
    expect(storage.staged.has("private/object-1")).toBe(true);

    store.failCommit = false;
    await expect(saga.sweep("2026-08-10T18:00:00.000Z")).resolves.toEqual({
      status: "completed",
      examined: 1,
      removed: 1,
      retained: 0,
      failed: 0,
    });
    expect(storage.staged.size).toBe(0);
  });

  it("retains committed objects and removes stale orphans idempotently", async () => {
    const { command, saga, storage } = setup();
    await saga.accept(command);
    storage.staged.set("private/orphan", {
      objectId: "private/orphan",
      operationId: "orphan-operation",
      stagedAt: "2026-08-10T16:00:00.000Z",
    });

    await expect(saga.sweep("2026-08-10T18:00:00.000Z")).resolves.toEqual({
      status: "completed",
      examined: 2,
      removed: 1,
      retained: 1,
      failed: 0,
    });
    await expect(saga.sweep("2026-08-10T18:00:00.000Z")).resolves.toEqual({
      status: "completed",
      examined: 1,
      removed: 0,
      retained: 1,
      failed: 0,
    });
  });

  it("rejects malformed commands before side effects and contains sweeper failures", async () => {
    const { command, dependencies, storage, store } = setup();
    const saga = createAttachmentSaga(storage, store, dependencies);

    for (const invalid of [
      { ...command, operationId: "not-a-uuid" },
      { ...command, feedbackId: " " },
      { ...command, files: [] },
      {
        ...command,
        audience: "workspace" as const,
        sourceEntry: { kind: "visible_message" as const, id: "message-1" },
      },
    ]) {
      await expect(saga.accept(invalid)).resolves.toEqual({
        status: "rejected",
        code: "ATTACHMENT_REJECTED",
      });
    }
    expect(storage.stageCalls).toEqual([]);

    const unavailableStorage: PrivateAttachmentStorage = {
      stage: (input) => storage.stage(input),
      remove: () => Promise.reject(new Error("remove down")),
      listStagedBefore: () => Promise.reject(new Error("list down")),
    };
    const unavailableSaga = createAttachmentSaga(
      unavailableStorage,
      store,
      dependencies,
    );
    await expect(unavailableSaga.sweep("2026-08-10T18:00:00.000Z")).resolves.toEqual({
      status: "retryable",
      code: "SWEEP_UNAVAILABLE",
    });

    storage.staged.set("private/unverified", {
      objectId: "private/unverified",
      operationId: "orphan-operation",
      stagedAt: "2026-08-10T16:00:00.000Z",
    });
    const failingStore: AttachmentAcceptanceStore = {
      commit: (input) => store.commit(input),
      isObjectAssociated: () => Promise.reject(new Error("lookup down")),
    };
    const containedSaga = createAttachmentSaga(storage, failingStore, dependencies);
    await expect(containedSaga.sweep("2026-08-10T18:00:00.000Z")).resolves.toEqual({
      status: "completed",
      examined: 1,
      removed: 0,
      retained: 0,
      failed: 1,
    });
  });
});
