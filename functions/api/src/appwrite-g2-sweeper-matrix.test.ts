/* eslint-disable @typescript-eslint/unbound-method -- Vitest replaces capability mocks without invoking detached methods. */
import { describe, expect, it, vi } from "vitest";

import type { AttachmentAcceptanceStore } from "./attachment-saga";
import type { PrivateAttachmentStorage } from "./attachment-saga";
import {
  runAppwriteG2SweeperMatrix,
  type AppwriteG2SweeperArtifacts,
} from "./appwrite-g2-sweeper-matrix";
import type { AttachmentSaga } from "./attachment-saga";

const schema = {
  databaseId: "feedback",
  attachmentBucketId: "attachments_private",
  attachmentStagingTableId: "attachment_staging",
  attachmentsTableId: "attachments",
};

const input = {
  operationId: "123e4567-e89b-42d3-a456-426614174020",
  attachmentId: "g2a_sweeper",
  associatedObjectId: "private/g2-associated",
  orphanObjectId: "private/g2-orphan",
  stagedAt: "2000-01-01T00:00:00.000Z",
  sweepBefore: "2000-01-01T00:00:01.000Z",
};

const missing = Object.assign(new Error("missing"), { code: 404 });

function setup() {
  const storage: PrivateAttachmentStorage = {
    stage: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    listStagedBefore: vi.fn(() =>
      Promise.resolve([
        {
          objectId: input.associatedObjectId,
          operationId: input.operationId,
          stagedAt: input.stagedAt,
        },
        {
          objectId: input.orphanObjectId,
          operationId: input.operationId,
          stagedAt: input.stagedAt,
        },
      ]),
    ),
  };
  const store: AttachmentAcceptanceStore = {
    commit: vi.fn(() => Promise.resolve()),
    isObjectAssociated: vi.fn((objectId: string) =>
      Promise.resolve(objectId === input.associatedObjectId),
    ),
  };
  const saga: AttachmentSaga = {
    accept: vi.fn(),
    sweep: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        examined: 2,
        removed: 1,
        retained: 1,
        failed: 0,
      }),
    ),
  };
  const getFile = vi.fn<AppwriteG2SweeperArtifacts["getFile"]>((request) =>
    request.fileId.includes("missing")
      ? Promise.reject(missing)
      : Promise.resolve({ $permissions: [] }),
  );
  const getRow = vi.fn<AppwriteG2SweeperArtifacts["getRow"]>(() =>
    Promise.resolve({ objectId: input.associatedObjectId }),
  );
  const deleteRow = vi.fn<AppwriteG2SweeperArtifacts["deleteRow"]>(() =>
    Promise.resolve({}),
  );
  return {
    artifacts: { getFile, getRow, deleteRow },
    deleteRow,
    getFile,
    getRow,
    saga,
    storage,
    store,
  };
}

describe("real Appwrite G2 sweeper matrix", () => {
  it("BDD-G2-REAL-005 removes an isolated orphan and retains associated private data", async () => {
    const target = setup();
    target.getFile
      .mockResolvedValueOnce({ $permissions: [] })
      .mockRejectedValueOnce(missing);
    target.getRow
      .mockResolvedValueOnce({ objectId: input.associatedObjectId })
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ objectId: input.associatedObjectId });

    await expect(
      runAppwriteG2SweeperMatrix(
        target.saga,
        target.storage,
        target.store,
        target.artifacts,
        schema,
        input,
      ),
    ).resolves.toEqual({
      isolatedSelection: true,
      orphanRemoved: true,
      associatedRetained: true,
      privateFile: true,
      cleanedRows: 1,
    });
    expect(target.storage.stage).toHaveBeenCalledTimes(2);
    expect(target.store.commit).toHaveBeenCalledOnce();
    expect(target.saga.sweep).toHaveBeenCalledWith(input.sweepBefore);
    expect(target.storage.remove).toHaveBeenCalledTimes(2);
  });

  it("BDD-G2-REAL-006 refuses to sweep when the cutoff selects unrelated staging", async () => {
    const target = setup();
    vi.mocked(target.storage.listStagedBefore).mockResolvedValueOnce([
      {
        objectId: "private/unrelated",
        operationId: input.operationId,
        stagedAt: input.stagedAt,
      },
    ]);

    await expect(
      runAppwriteG2SweeperMatrix(
        target.saga,
        target.storage,
        target.store,
        target.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_SWEEPER_MATRIX_FAILED");
    expect(target.saga.sweep).not.toHaveBeenCalled();
    expect(target.storage.remove).toHaveBeenCalledTimes(2);
  });

  it("BDD-G2-REAL-007 fails closed for incomplete sweep and artifact evidence", async () => {
    for (const outcome of [
      { status: "retryable", code: "SWEEP_UNAVAILABLE" } as const,
      {
        status: "completed",
        examined: 2,
        removed: 0,
        retained: 2,
        failed: 0,
      } as const,
      {
        status: "completed",
        examined: 2,
        removed: 1,
        retained: 0,
        failed: 1,
      } as const,
    ]) {
      const target = setup();
      vi.mocked(target.saga.sweep).mockResolvedValueOnce(outcome);
      await expect(
        runAppwriteG2SweeperMatrix(
          target.saga,
          target.storage,
          target.store,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_SWEEPER_MATRIX_FAILED");
    }

    for (const permissions of [undefined, ['read("any")']]) {
      const target = setup();
      target.getFile
        .mockResolvedValueOnce(
          permissions === undefined ? {} : { $permissions: permissions },
        )
        .mockRejectedValueOnce(missing);
      target.getRow
        .mockResolvedValueOnce({ objectId: input.associatedObjectId })
        .mockRejectedValueOnce(missing)
        .mockResolvedValueOnce({ objectId: input.associatedObjectId });
      await expect(
        runAppwriteG2SweeperMatrix(
          target.saga,
          target.storage,
          target.store,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_SWEEPER_MATRIX_FAILED");
    }
  });

  it("BDD-G2-REAL-008 preserves cleanup failures", async () => {
    const removal = setup();
    vi.mocked(removal.storage.remove).mockRejectedValueOnce(new Error("remove failed"));
    await expect(
      runAppwriteG2SweeperMatrix(
        removal.saga,
        removal.storage,
        removal.store,
        removal.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("remove failed");

    const metadata = setup();
    metadata.deleteRow.mockRejectedValueOnce(new Error("delete failed"));
    await expect(
      runAppwriteG2SweeperMatrix(
        metadata.saga,
        metadata.storage,
        metadata.store,
        metadata.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("delete failed");

    const nonError = setup();
    vi.mocked(nonError.storage.remove).mockRejectedValueOnce("remove failed");
    await expect(
      runAppwriteG2SweeperMatrix(
        nonError.saga,
        nonError.storage,
        nonError.store,
        nonError.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_SWEEPER_CLEANUP_FAILED");

    const absentMetadata = setup();
    absentMetadata.deleteRow.mockRejectedValueOnce(missing);
    await expect(
      runAppwriteG2SweeperMatrix(
        absentMetadata.saga,
        absentMetadata.storage,
        absentMetadata.store,
        absentMetadata.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_SWEEPER_MATRIX_FAILED");
  });

  it("BDD-G2-REAL-009 preserves unexpected artifact lookup failures", async () => {
    const target = setup();
    target.getRow
      .mockResolvedValueOnce({ objectId: input.associatedObjectId })
      .mockRejectedValueOnce(new Error("lookup failed"));
    await expect(
      runAppwriteG2SweeperMatrix(
        target.saga,
        target.storage,
        target.store,
        target.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_SWEEPER_MATRIX_FAILED");
  });
});
