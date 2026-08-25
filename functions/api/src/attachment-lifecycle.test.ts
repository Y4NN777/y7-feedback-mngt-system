import { describe, expect, it, vi } from "vitest";

import {
  createAttachmentRecord,
  type AttachmentLifecycle,
  type AttachmentRecord,
} from "@y7-feedback/domain";

import {
  createAttachmentLifecycleCoordinator,
  type AttachmentLifecycleRepository,
} from "./attachment-lifecycle";

function attachment(lifecycle: AttachmentLifecycle = "available"): AttachmentRecord {
  return {
    ...createAttachmentRecord({
      id: "attachment-1",
      objectId: "private/object-1",
      feedbackId: "feedback-1",
      workspaceId: "workspace-a",
      projectId: "project-a",
      audience: "reporter",
      sourceEntry: { kind: "source_submission", id: "source-1" },
      displayName: "evidence.txt",
      mediaType: "text/plain; charset=utf-8",
      size: 8,
      sha256: "digest",
      createdAt: "2026-08-25T03:00:00.000Z",
    }),
    lifecycle,
  };
}

const authorization = {
  kind: "workspace_actor" as const,
  authorizedWorkspaceId: "workspace-a",
  authorizedProjectId: "project-a",
  canReadAttachments: true,
};

function setup(initial: AttachmentRecord | null = attachment()) {
  let current = initial ?? undefined;
  const findById = vi.fn<AttachmentLifecycleRepository["findById"]>(() =>
    Promise.resolve(current),
  );
  const compareAndSetLifecycle = vi.fn<
    AttachmentLifecycleRepository["compareAndSetLifecycle"]
  >((id, expected, next) => {
    if (!current || current.id !== id || current.lifecycle !== expected) {
      return Promise.resolve(false);
    }
    current = { ...current, lifecycle: next };
    return Promise.resolve(true);
  });
  const repository: AttachmentLifecycleRepository = {
    findById,
    compareAndSetLifecycle,
  };
  const remove = vi.fn(() => Promise.resolve());
  return {
    coordinator: createAttachmentLifecycleCoordinator(repository, { remove }),
    current: () => current,
    compareAndSetLifecycle,
    findById,
    remove,
    repository,
  };
}

describe("Attachment lifecycle coordination", () => {
  it.each(["", " ", "a".repeat(201)])(
    "denies malformed attachment identity %j before reading",
    async (attachmentId) => {
      const target = setup();
      await expect(
        target.coordinator.transition({
          attachmentId,
          authorization,
          operation: "soft_delete",
        }),
      ).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
      expect(target.findById).not.toHaveBeenCalled();
    },
  );

  it("BDD-ATT-LIFECYCLE-002 hides, restores, and irreversibly purges in order", async () => {
    const target = setup();

    await expect(
      target.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "soft_delete",
      }),
    ).resolves.toEqual({ status: "ok", lifecycle: "soft_deleted" });
    expect(target.remove).not.toHaveBeenCalled();

    await expect(
      target.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "restore",
      }),
    ).resolves.toEqual({ status: "ok", lifecycle: "available" });

    await expect(
      target.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "purge",
      }),
    ).resolves.toEqual({ status: "ok", lifecycle: "purged" });
    expect(target.current()?.lifecycle).toBe("purged");
    expect(target.remove).toHaveBeenCalledWith("private/object-1");

    await expect(
      target.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "purge",
      }),
    ).resolves.toEqual({ status: "ok", lifecycle: "purged" });
    expect(target.remove).toHaveBeenCalledTimes(2);
  });

  it("BDD-ATT-LIFECYCLE-003 denies missing, public, removed, and cross-scope actors before mutation", async () => {
    for (const [record, actor] of [
      [null, authorization],
      [attachment(), { kind: "public" as const }],
      [attachment(), { ...authorization, canReadAttachments: false }],
      [attachment(), { ...authorization, authorizedWorkspaceId: "workspace-b" }],
      [attachment(), { ...authorization, authorizedProjectId: "project-b" }],
    ] as const) {
      const target = setup(record);
      await expect(
        target.coordinator.transition({
          attachmentId: "attachment-1",
          authorization: actor,
          operation: "soft_delete",
        }),
      ).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
      expect(target.compareAndSetLifecycle).not.toHaveBeenCalled();
      expect(target.remove).not.toHaveBeenCalled();
    }
  });

  it("rejects an impossible transition without persistence", async () => {
    const target = setup(attachment("purged"));

    await expect(
      target.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "restore",
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "ATTACHMENT_LIFECYCLE_INVALID",
    });
    expect(target.compareAndSetLifecycle).not.toHaveBeenCalled();
  });

  it("returns retryable on stale state, persistence failure, or incomplete purge", async () => {
    const stale = setup();
    stale.compareAndSetLifecycle.mockResolvedValueOnce(false);
    await expect(
      stale.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "soft_delete",
      }),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE",
    });

    const failedRead = setup();
    failedRead.findById.mockRejectedValueOnce(new Error("private database detail"));
    await expect(
      failedRead.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "soft_delete",
      }),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE",
    });

    const failedWrite = setup();
    failedWrite.compareAndSetLifecycle.mockRejectedValueOnce(
      new Error("private transaction detail"),
    );
    await expect(
      failedWrite.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "soft_delete",
      }),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE",
    });

    const failedRemoval = setup();
    failedRemoval.remove.mockRejectedValueOnce(new Error("private storage detail"));
    await expect(
      failedRemoval.coordinator.transition({
        attachmentId: "attachment-1",
        authorization,
        operation: "purge",
      }),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE",
    });
    expect(failedRemoval.current()?.lifecycle).toBe("purged");
  });
});
