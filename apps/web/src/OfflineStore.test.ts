import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createIndexedDbOfflineStore, OfflineStoreError } from "./OfflineStore";

const databases: string[] = [];

function store() {
  const name = `y7-offline-test-${crypto.randomUUID()}`;
  databases.push(name);
  return createIndexedDbOfflineStore({
    databaseName: name,
    now: () => "2026-09-02T04:00:00.000Z",
  });
}

const preview = {
  environment: "preview",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "reporter_1",
  proofContextDigest: "sha256_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
} as const;
const digestOne = `sha256_${"A".repeat(43)}`;
const digestTwo = `sha256_${"B".repeat(43)}`;
const digestChanged = `sha256_${"C".repeat(43)}`;

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => {
            resolve();
          };
          request.onerror = () => {
            resolve();
          };
          request.onblocked = () => {
            resolve();
          };
        }),
    ),
  );
});

describe("partitioned offline persistence", () => {
  it("BDD-OFF-001 restores a draft only inside its exact authority partition", async () => {
    const offline = store();
    await offline.saveDraft(preview, "intake", { type: "bug", problem: "Lost" });

    await expect(offline.loadDraft(preview, "intake")).resolves.toMatchObject({
      payload: { type: "bug", problem: "Lost" },
      version: 1,
    });
    await expect(
      offline.loadDraft({ ...preview, projectId: "project_2" }, "intake"),
    ).resolves.toBeNull();
    await expect(
      offline.loadDraft({ ...preview, environment: "production" }, "intake"),
    ).resolves.toBeNull();
    await offline.close();
  });

  it("BDD-OFF-002 never persists an Access Proof or authorization material", async () => {
    const offline = store();
    await expect(
      offline.saveDraft(preview, "intake", {
        nested: { accessProof: "forbidden" },
      }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_PROHIBITED_DATA"));
    await expect(
      offline.enqueue(preview, {
        clientOperationId: "operation_1",
        kind: "intake",
        payloadDigest: digestOne,
        payload: { authorization: "Bearer forbidden" },
        dependencies: [],
      }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_PROHIBITED_DATA"));
    await offline.close();
  });

  it("BDD-OFF-003 stores bounded blobs and rejects the sixth or oversized blob", async () => {
    const offline = store();
    for (let index = 0; index < 5; index += 1) {
      await offline.putBlob(preview, `attachment_${String(index)}`, new Blob(["safe"]));
    }
    await expect(
      offline.putBlob(preview, "attachment_5", new Blob(["safe"])),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_BLOB_LIMIT"));
    await expect(
      offline.putBlob(
        { ...preview, actorId: "reporter_2" },
        "attachment_large",
        new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
      ),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_BLOB_SIZE"));
    await offline.close();
  });

  it("BDD-OFF-004 preserves operation ordering and dependencies", async () => {
    const offline = store();
    await offline.enqueue(preview, {
      clientOperationId: "operation_1",
      kind: "intake",
      payloadDigest: digestOne,
      payload: { value: 1 },
      dependencies: [],
    });
    await offline.enqueue(preview, {
      clientOperationId: "operation_2",
      kind: "attachment",
      payloadDigest: digestTwo,
      payload: { value: 2 },
      dependencies: ["operation_1"],
    });

    await expect(offline.listOperations(preview)).resolves.toMatchObject([
      { clientOperationId: "operation_1", sequence: 1, status: "queued" },
      {
        clientOperationId: "operation_2",
        sequence: 2,
        dependencies: ["operation_1"],
      },
    ]);
    await offline.close();
  });

  it("BDD-OFF-005 erases drafts, blobs, projections and outbox for only one scope", async () => {
    const offline = store();
    const sibling = { ...preview, projectId: "project_2" };
    await offline.saveDraft(preview, "intake", { value: "delete" });
    await offline.putBlob(preview, "attachment_1", new Blob(["delete"]));
    await offline.saveProjection(preview, "feedback_1", { state: "open" });
    await offline.enqueue(preview, {
      clientOperationId: "operation_1",
      kind: "intake",
      payloadDigest: digestOne,
      payload: { value: 1 },
      dependencies: [],
    });
    await offline.saveDraft(sibling, "intake", { value: "retain" });

    await expect(offline.eraseScope(preview)).resolves.toEqual({ deleted: 4 });
    await expect(offline.loadDraft(preview, "intake")).resolves.toBeNull();
    await expect(offline.listOperations(preview)).resolves.toEqual([]);
    await expect(offline.loadDraft(sibling, "intake")).resolves.toMatchObject({
      payload: { value: "retain" },
    });
    await offline.close();
  });

  it("BDD-OFF-006 fails closed on malformed scope and operation conflicts", async () => {
    const offline = store();
    await expect(
      offline.saveDraft({ ...preview, actorId: "bad actor" }, "intake", {}),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_SCOPE_INVALID"));
    const operation = {
      clientOperationId: "operation_1",
      kind: "intake" as const,
      payloadDigest: digestOne,
      payload: { value: 1 },
      dependencies: [] as const,
    };
    await offline.enqueue(preview, operation);
    await expect(offline.enqueue(preview, operation)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      offline.enqueue(preview, { ...operation, payloadDigest: digestChanged }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_OPERATION_CONFLICT"));
    await offline.close();
  });

  it("BDD-OFF-007 validates identifiers, digests and structured-clone payloads", async () => {
    expect(() =>
      createIndexedDbOfflineStore({ databaseName: "bad database name" }),
    ).toThrow(new OfflineStoreError("OFFLINE_NAME_INVALID"));
    const offline = store();
    await offline.close();
    await expect(offline.saveDraft(preview, "bad id", {})).rejects.toEqual(
      new OfflineStoreError("OFFLINE_ID_INVALID"),
    );
    await expect(
      offline.enqueue(preview, {
        clientOperationId: "operation_1",
        kind: "intake",
        payloadDigest: "invalid",
        payload: {},
        dependencies: [],
      }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_OPERATION_INVALID"));
    await expect(
      offline.enqueue(preview, {
        clientOperationId: "operation_1",
        kind: "intake",
        payloadDigest: digestOne,
        payload: {},
        dependencies: ["bad dependency"],
      }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_OPERATION_INVALID"));
    await expect(
      offline.saveProjection(preview, "feedback_1", { score: Number.NaN }),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_PROHIBITED_DATA"));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(offline.saveProjection(preview, "feedback_1", cyclic)).rejects.toEqual(
      new OfflineStoreError("OFFLINE_PROHIBITED_DATA"),
    );

    const first = await offline.saveDraft(preview, "intake", { values: [1, true] });
    const second = await offline.saveDraft(preview, "intake", { value: "updated" });
    expect([first.version, second.version]).toEqual([1, 2]);
    await offline.close();
  });

  it("BDD-OFF-008 maps an IndexedDB open failure to a stable retryable code", async () => {
    const original = globalThis.indexedDB;
    const failedRequest = {} as IDBOpenDBRequest;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          queueMicrotask(() => {
            failedRequest.onerror?.(new Event("error"));
          });
          return failedRequest;
        },
      },
    });
    try {
      const offline = createIndexedDbOfflineStore({ databaseName: "open_failure" });
      await expect(offline.loadDraft(preview, "intake")).rejects.toEqual(
        new OfflineStoreError("OFFLINE_OPEN_FAILED"),
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: original,
      });
    }
  });

  it("BDD-OFF-009 transitions retries, conflicts and completion atomically", async () => {
    const offline = store();
    await offline.enqueue(preview, {
      clientOperationId: "operation_1",
      kind: "intake",
      payloadDigest: digestOne,
      payload: { value: 1 },
      dependencies: [],
    });
    await expect(offline.claimOperation(preview, "operation_1")).resolves.toMatchObject(
      { status: "processing", attempts: 1 },
    );
    await expect(
      offline.retryOperation(preview, "operation_1", "invalid", "retryable"),
    ).rejects.toEqual(new OfflineStoreError("OFFLINE_RETRY_INVALID"));
    await offline.retryOperation(
      preview,
      "operation_1",
      "2026-09-02T04:01:00.000Z",
      "retryable",
    );
    await expect(offline.claimOperation(preview, "operation_1")).resolves.toMatchObject(
      { status: "processing", attempts: 2 },
    );
    await offline.conflictOperation(preview, "operation_1");
    await expect(offline.listOperations(preview)).resolves.toMatchObject([
      { status: "conflict", lastErrorCode: "payload_conflict" },
    ]);
    await expect(offline.completeOperation(preview, "operation_1")).rejects.toEqual(
      new OfflineStoreError("OFFLINE_OPERATION_STATE_CONFLICT"),
    );

    await offline.enqueue(preview, {
      clientOperationId: "operation_2",
      kind: "message",
      payloadDigest: digestTwo,
      payload: { value: 2 },
      dependencies: [],
    });
    await offline.claimOperation(preview, "operation_2");
    await offline.completeOperation(preview, "operation_2");
    await expect(offline.listOperations(preview)).resolves.toHaveLength(1);
    await offline.enqueue(preview, {
      clientOperationId: "operation_3",
      kind: "lifecycle",
      payloadDigest: digestChanged,
      payload: { value: 3 },
      dependencies: [],
    });
    await offline.claimOperation(preview, "operation_3");
    await expect(offline.recoverOperations(preview, "invalid")).rejects.toEqual(
      new OfflineStoreError("OFFLINE_RECOVERY_INVALID"),
    );
    await expect(
      offline.recoverOperations(preview, "2026-09-02T04:01:00.000Z"),
    ).resolves.toEqual({ recovered: 1 });
    await expect(offline.claimOperation(preview, "operation_3")).resolves.toMatchObject(
      { status: "processing", attempts: 2 },
    );
    await offline.close();
  });
});
