import { describe, expect, it } from "vitest";

import {
  createAttachmentRecord,
  transitionAttachmentLifecycle,
  type AttachmentAuthorization,
  type AttachmentRecord,
} from "@y7-feedback/domain";

import type {
  AttachmentMetadataReader,
  PrivateAttachmentReader,
} from "./attachment-download";
import { createAttachmentDownload } from "./attachment-download";

function reporterAttachment(): AttachmentRecord {
  return createAttachmentRecord({
    id: "attachment-1",
    objectId: "private/object-1",
    feedbackId: "feedback-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    audience: "reporter",
    sourceEntry: { kind: "source_submission", id: "source-1" },
    displayName: "evidence.txt",
    mediaType: "text/plain; charset=utf-8",
    size: 4,
    sha256: "safe_digest",
    createdAt: "2026-08-10T17:00:00.000Z",
  });
}

function setup(record: AttachmentRecord | null = reporterAttachment()) {
  const reads: string[] = [];
  const metadata: AttachmentMetadataReader = {
    findById: () => Promise.resolve(record ?? undefined),
  };
  const storage: PrivateAttachmentReader = {
    read: (objectId) => {
      reads.push(objectId);
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]));
    },
  };
  return {
    download: createAttachmentDownload(metadata, storage),
    reads,
  };
}

describe("trusted private Attachment download", () => {
  it("BDD-ATT-005 returns bytes and safe metadata only after Reporter authorization", async () => {
    const { download, reads } = setup();

    await expect(
      download("attachment-1", {
        kind: "reporter",
        authorizedFeedbackId: "feedback-1",
      }),
    ).resolves.toEqual({
      status: "available",
      attachmentId: "attachment-1",
      displayName: "evidence.txt",
      mediaType: "text/plain; charset=utf-8",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(reads).toEqual(["private/object-1"]);
  });

  it("allows an assigned actor in the exact Workspace and Project scope", async () => {
    const { download } = setup();

    await expect(
      download("attachment-1", {
        kind: "workspace_actor",
        authorizedWorkspaceId: "workspace-1",
        authorizedProjectId: "project-1",
        canReadAttachments: true,
      }),
    ).resolves.toMatchObject({ status: "available" });
  });

  it("denies malformed identifiers before any trusted lookup", async () => {
    let lookups = 0;
    const metadata: AttachmentMetadataReader = {
      findById: () => {
        lookups += 1;
        return Promise.resolve(reporterAttachment());
      },
    };
    const storage: PrivateAttachmentReader = {
      read: () => Promise.resolve(new Uint8Array()),
    };
    const download = createAttachmentDownload(metadata, storage);
    const authorization: AttachmentAuthorization = { kind: "public" };

    for (const attachmentId of [" ", "a".repeat(201)]) {
      await expect(download(attachmentId, authorization)).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
    }
    expect(lookups).toBe(0);
  });

  it("uses one non-disclosing denial for unknown, cross-scope, removed, and public access", async () => {
    const attachment = reporterAttachment();
    const cases: readonly [AttachmentRecord | null, AttachmentAuthorization][] = [
      [null, { kind: "public" }],
      [attachment, { kind: "public" }],
      [attachment, { kind: "reporter", authorizedFeedbackId: "feedback-sibling" }],
      [
        attachment,
        {
          kind: "workspace_actor",
          authorizedWorkspaceId: "workspace-other",
          authorizedProjectId: "project-1",
          canReadAttachments: true,
        },
      ],
      [
        attachment,
        {
          kind: "workspace_actor",
          authorizedWorkspaceId: "workspace-1",
          authorizedProjectId: "project-1",
          canReadAttachments: false,
        },
      ],
      [
        transitionAttachmentLifecycle(attachment, "soft_delete"),
        { kind: "reporter", authorizedFeedbackId: "feedback-1" },
      ],
      [
        transitionAttachmentLifecycle(attachment, "purge"),
        { kind: "reporter", authorizedFeedbackId: "feedback-1" },
      ],
    ];

    for (const [record, authorization] of cases) {
      const { download, reads } = setup(record);
      await expect(download("attachment-1", authorization)).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
      expect(reads).toEqual([]);
    }
  });

  it("reveals only retryability when trusted metadata or private bytes are unavailable", async () => {
    const storage: PrivateAttachmentReader = {
      read: () => Promise.reject(new Error("storage down")),
    };
    const unavailableMetadata: AttachmentMetadataReader = {
      findById: () => Promise.reject(new Error("database down")),
    };
    const availableMetadata: AttachmentMetadataReader = {
      findById: () => Promise.resolve(reporterAttachment()),
    };
    const authorization: AttachmentAuthorization = {
      kind: "reporter",
      authorizedFeedbackId: "feedback-1",
    };

    await expect(
      createAttachmentDownload(unavailableMetadata, storage)(
        "attachment-1",
        authorization,
      ),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
    await expect(
      createAttachmentDownload(availableMetadata, storage)(
        "attachment-1",
        authorization,
      ),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
  });
});
