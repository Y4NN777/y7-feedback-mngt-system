/* eslint-disable @typescript-eslint/unbound-method -- Vitest replaces the saga capability mock without invoking a detached method. */
import { describe, expect, it, vi } from "vitest";

import {
  runAppwriteG2AttachmentMatrix,
  type AppwriteG2AttachmentArtifacts,
} from "./appwrite-g2-attachment-matrix";
import type { AttachmentSaga } from "./attachment-saga";
import type { AttachmentDownload } from "./attachment-download";
import type { PublicApi, PublicApiResponse } from "./public-api";

const schema = {
  databaseId: "feedback",
  reportersTableId: "reporters",
  feedbackTableId: "feedback_items",
  lifecycleTableId: "feedback_lifecycle",
  accessGrantsTableId: "access_grants",
  notificationsTableId: "notifications",
  outboxTableId: "notification_outbox",
  idempotencyTableId: "intake_idempotency",
  attachmentBucketId: "attachments_private",
  attachmentStagingTableId: "attachment_staging",
  attachmentsTableId: "attachments",
};
const input = {
  intakeIds: {
    feedbackId: "g2f_attachment",
    reporterId: "g2r_attachment",
    notificationId: "g2n_attachment",
    lifecycleId: "g2l_attachment",
    outboxId: "g2o_attachment",
  },
  intakeOperationId: "123e4567-e89b-42d3-a456-426614174010",
  attachmentOperationId: "123e4567-e89b-42d3-a456-426614174011",
  attachmentId: "g2a_attachment",
  objectId: "private/g2-object",
  stagedAt: "2026-08-24T23:00:00.000Z",
};
const attachmentBytes = new TextEncoder().encode("Y7 attachment evidence\n");

function setup(
  response: PublicApiResponse = {
    statusCode: 201,
    body: {
      status: "accepted",
      replayed: false,
      reference: "Y7-G2-TEST",
      accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
    },
  },
) {
  const api: PublicApi = { handle: () => Promise.resolve(response) };
  const saga: AttachmentSaga = {
    accept: vi.fn(() =>
      Promise.resolve({
        status: "accepted" as const,
        feedbackId: input.intakeIds.feedbackId,
        attachmentIds: [input.attachmentId],
      }),
    ),
    sweep: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        examined: 0,
        removed: 0,
        retained: 0,
        failed: 0,
      }),
    ),
  };
  const download = vi
    .fn<AttachmentDownload>()
    .mockResolvedValueOnce({
      status: "available",
      attachmentId: input.attachmentId,
      displayName: "evidence.txt",
      mediaType: "text/plain; charset=utf-8",
      bytes: attachmentBytes,
    })
    .mockResolvedValueOnce({
      status: "denied",
      code: "ATTACHMENT_ACCESS_DENIED",
    });
  const getFile = vi.fn<AppwriteG2AttachmentArtifacts["getFile"]>(() =>
    Promise.resolve({ $permissions: [] }),
  );
  const getRow = vi
    .fn<AppwriteG2AttachmentArtifacts["getRow"]>()
    .mockResolvedValueOnce({
      objectId: input.objectId,
      operationId: input.attachmentOperationId,
      stagedAt: input.stagedAt,
    })
    .mockResolvedValueOnce({
      objectId: input.objectId,
      displayName: "v1.envelope",
    });
  const deleteRow = vi.fn<AppwriteG2AttachmentArtifacts["deleteRow"]>(() =>
    Promise.resolve({}),
  );
  const remove = vi.fn(() => Promise.resolve());
  return {
    api,
    artifacts: { getFile, getRow, deleteRow } satisfies AppwriteG2AttachmentArtifacts,
    deleteRow,
    download,
    getFile,
    getRow,
    saga,
    storage: { remove },
  };
}

describe("real Appwrite G2 attachment matrix", () => {
  it("BDD-G2-REAL-001 proves private staging, encrypted metadata, scoped download, and cleanup", async () => {
    const target = setup();
    await expect(
      runAppwriteG2AttachmentMatrix(
        target.api,
        target.saga,
        target.download,
        target.storage,
        target.artifacts,
        schema,
        input,
      ),
    ).resolves.toEqual({
      accepted: true,
      privateFile: true,
      metadataEncrypted: true,
      authorizedDownload: true,
      siblingDenied: true,
      removedObject: true,
      cleanedRows: 8,
    });
    expect(target.getFile).toHaveBeenCalledOnce();
    expect(target.deleteRow).toHaveBeenCalledTimes(8);
    expect(target.storage.remove).toHaveBeenCalledWith(input.objectId);
  });

  it("BDD-ATT-DEPLOYED-007 binds deployed download evidence to the accepted proof and Attachment", async () => {
    const target = setup();
    const deployedEvidence = vi.fn(() =>
      Promise.resolve({
        authorizedDownload: true as const,
        siblingDenied: true as const,
        siblingCleanedRows: 7,
        softDeleteHidden: true,
        restoreAuthorized: true,
        purgeHidden: true,
        purgeRemoved: true,
      }),
    );

    await expect(
      runAppwriteG2AttachmentMatrix(
        target.api,
        target.saga,
        target.download,
        target.storage,
        target.artifacts,
        schema,
        input,
        deployedEvidence,
      ),
    ).resolves.toMatchObject({
      deployedAuthorizedDownload: true,
      deployedSiblingDenied: true,
      deployedSiblingCleanedRows: 7,
      deployedSoftDeleteHidden: true,
      deployedRestoreAuthorized: true,
      deployedPurgeHidden: true,
      deployedPurgeRemoved: true,
    });
    expect(deployedEvidence).toHaveBeenCalledWith({
      attachmentId: input.attachmentId,
      reference: "Y7-G2-TEST",
      accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
      bytes: attachmentBytes,
      displayName: "evidence.txt",
      mediaType: "text/plain; charset=utf-8",
    });
  });

  it("rejects incomplete deployed evidence and still cleans every parent row", async () => {
    const target = setup();
    await expect(
      runAppwriteG2AttachmentMatrix(
        target.api,
        target.saga,
        target.download,
        target.storage,
        target.artifacts,
        schema,
        input,
        () =>
          Promise.resolve({
            authorizedDownload: false,
            siblingDenied: true,
            siblingCleanedRows: 7,
          } as never),
      ),
    ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
    expect(target.deleteRow).toHaveBeenCalledTimes(8);
  });

  it("BDD-G2-REAL-002 fails closed for parent and acceptance inconsistencies", async () => {
    for (const response of [
      { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } },
      {
        statusCode: 201,
        body: {
          status: "wrong",
          replayed: false,
          reference: "Y7-G2-TEST",
          accessProof: "proof",
        },
      },
      {
        statusCode: 201,
        body: {
          status: "accepted",
          replayed: true,
          reference: "Y7-G2-TEST",
          accessProof: "proof",
        },
      },
      { statusCode: 201, body: null },
    ] satisfies readonly PublicApiResponse[]) {
      const target = setup(response);
      await expect(
        runAppwriteG2AttachmentMatrix(
          target.api,
          target.saga,
          target.download,
          target.storage,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
    }

    for (const outcome of [
      { status: "rejected", code: "ATTACHMENT_REJECTED" } as const,
      {
        status: "accepted",
        feedbackId: "wrong",
        attachmentIds: [input.attachmentId],
      } as const,
      {
        status: "accepted",
        feedbackId: input.intakeIds.feedbackId,
        attachmentIds: [],
      } as const,
      {
        status: "accepted",
        feedbackId: input.intakeIds.feedbackId,
        attachmentIds: ["wrong"],
      } as const,
    ]) {
      const target = setup();
      vi.mocked(target.saga.accept).mockResolvedValueOnce(outcome);
      await expect(
        runAppwriteG2AttachmentMatrix(
          target.api,
          target.saga,
          target.download,
          target.storage,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
    }
  });

  it("BDD-G2-REAL-003 rejects public artifacts, plaintext, altered downloads, and sibling access", async () => {
    const validStaging = {
      objectId: input.objectId,
      operationId: input.attachmentOperationId,
      stagedAt: input.stagedAt,
    };
    const invalidArtifacts: readonly (readonly unknown[])[] = [
      [null, validStaging, { objectId: input.objectId, displayName: "v1.envelope" }],
      [
        { $permissions: ['read("any")'] },
        validStaging,
        { objectId: input.objectId, displayName: "v1.envelope" },
      ],
      [
        { $permissions: [] },
        null,
        { objectId: input.objectId, displayName: "v1.envelope" },
      ],
      [
        { $permissions: [] },
        { ...validStaging, objectId: "wrong" },
        { objectId: input.objectId, displayName: "v1.envelope" },
      ],
      [
        { $permissions: [] },
        { ...validStaging, operationId: "wrong" },
        { objectId: input.objectId, displayName: "v1.envelope" },
      ],
      [{ $permissions: [] }, { ...validStaging, stagedAt: "wrong" }, null],
      [
        { $permissions: [] },
        validStaging,
        { objectId: "wrong", displayName: "v1.envelope" },
      ],
      [
        { $permissions: [] },
        validStaging,
        { objectId: input.objectId, displayName: "plain" },
      ],
    ];
    for (const [file, staging, metadata] of invalidArtifacts) {
      const target = setup();
      target.getFile.mockResolvedValueOnce(file);
      target.getRow.mockReset();
      target.getRow.mockResolvedValueOnce(staging).mockResolvedValueOnce(metadata);
      await expect(
        runAppwriteG2AttachmentMatrix(
          target.api,
          target.saga,
          target.download,
          target.storage,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
    }

    for (const firstDownload of [
      { status: "denied", code: "ATTACHMENT_ACCESS_DENIED" } as const,
      {
        status: "available",
        attachmentId: input.attachmentId,
        displayName: "wrong",
        mediaType: "text/plain; charset=utf-8",
        bytes: attachmentBytes,
      } as const,
      {
        status: "available",
        attachmentId: input.attachmentId,
        displayName: "evidence.txt",
        mediaType: "wrong",
        bytes: attachmentBytes,
      } as const,
      {
        status: "available",
        attachmentId: input.attachmentId,
        displayName: "evidence.txt",
        mediaType: "text/plain; charset=utf-8",
        bytes: new Uint8Array([1]),
      } as const,
    ]) {
      const target = setup();
      target.download.mockReset();
      target.download.mockResolvedValueOnce(firstDownload);
      await expect(
        runAppwriteG2AttachmentMatrix(
          target.api,
          target.saga,
          target.download,
          target.storage,
          target.artifacts,
          schema,
          input,
        ),
      ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
    }

    const sibling = setup();
    sibling.download.mockReset();
    sibling.download
      .mockResolvedValueOnce({
        status: "available",
        attachmentId: input.attachmentId,
        displayName: "evidence.txt",
        mediaType: "text/plain; charset=utf-8",
        bytes: attachmentBytes,
      })
      .mockResolvedValueOnce({
        status: "available",
        attachmentId: input.attachmentId,
        displayName: "evidence.txt",
        mediaType: "text/plain; charset=utf-8",
        bytes: attachmentBytes,
      });
    await expect(
      runAppwriteG2AttachmentMatrix(
        sibling.api,
        sibling.saga,
        sibling.download,
        sibling.storage,
        sibling.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
  });

  it("BDD-G2-REAL-004 preserves cleanup failures and rejects incomplete cleanup", async () => {
    const removal = setup();
    removal.storage.remove.mockRejectedValueOnce(new Error("remove failed"));
    await expect(
      runAppwriteG2AttachmentMatrix(
        removal.api,
        removal.saga,
        removal.download,
        removal.storage,
        removal.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("remove failed");

    const cleanup = setup();
    cleanup.deleteRow.mockRejectedValueOnce("cleanup failed");
    await expect(
      runAppwriteG2AttachmentMatrix(
        cleanup.api,
        cleanup.saga,
        cleanup.download,
        cleanup.storage,
        cleanup.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_CLEANUP_FAILED");

    const missing = setup();
    missing.deleteRow.mockRejectedValue(
      Object.assign(new Error("missing"), { code: 404 }),
    );
    await expect(
      runAppwriteG2AttachmentMatrix(
        missing.api,
        missing.saga,
        missing.download,
        missing.storage,
        missing.artifacts,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED");
  });
});
