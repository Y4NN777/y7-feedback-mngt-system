import { describe, expect, it } from "vitest";

import {
  AttachmentPolicyError,
  authorizeAttachment,
  authorizeAttachmentLifecycle,
  createAttachmentRecord,
  transitionAttachmentLifecycle,
  type AttachmentRecord,
} from "./attachment";

function reporterAttachment(): AttachmentRecord {
  return createAttachmentRecord({
    id: "attachment-1",
    objectId: "private/object-1",
    feedbackId: "feedback-1",
    workspaceId: "workspace-a",
    projectId: "project-a",
    audience: "reporter",
    sourceEntry: { kind: "source_submission", id: "source-1" },
    displayName: "capture.png",
    mediaType: "image/png",
    size: 128,
    sha256: "sha256digestvalue",
    createdAt: "2026-08-10T17:00:00.000Z",
  });
}

function expectDenied(action: () => unknown) {
  expect(action).toThrow(
    expect.objectContaining<Partial<AttachmentPolicyError>>({
      code: "ATTACHMENT_ACCESS_DENIED",
    }),
  );
}

describe("Attachment ownership and authorization", () => {
  it("BDD-ATT-005 authorizes Reporter-visible evidence only for its Feedback", () => {
    const attachment = reporterAttachment();

    expect(
      authorizeAttachment(attachment, {
        kind: "reporter",
        authorizedFeedbackId: "feedback-1",
      }),
    ).toEqual({ attachmentId: "attachment-1", objectId: "private/object-1" });
    expectDenied(() =>
      authorizeAttachment(attachment, {
        kind: "reporter",
        authorizedFeedbackId: "feedback-2",
      }),
    );

    const internal = createAttachmentRecord({
      ...attachment,
      lifecycle: "available",
      id: "attachment-2",
      objectId: "private/object-2",
      audience: "workspace",
      sourceEntry: { kind: "internal_note", id: "note-1" },
    });
    expectDenied(() =>
      authorizeAttachment(internal, {
        kind: "reporter",
        authorizedFeedbackId: "feedback-1",
      }),
    );
  });

  it("authorizes current workspace capability only in exact Workspace and Project scope", () => {
    const attachment = reporterAttachment();
    const exact = {
      kind: "workspace_actor" as const,
      authorizedWorkspaceId: "workspace-a",
      authorizedProjectId: "project-a",
      canReadAttachments: true,
    };

    expect(authorizeAttachment(attachment, exact)).toEqual({
      attachmentId: "attachment-1",
      objectId: "private/object-1",
    });
    for (const authorization of [
      { ...exact, authorizedWorkspaceId: "workspace-b" },
      { ...exact, authorizedProjectId: "project-b" },
      { ...exact, canReadAttachments: false },
      { kind: "public" as const },
    ]) {
      expectDenied(() => authorizeAttachment(attachment, authorization));
    }
    expectDenied(() => authorizeAttachment(undefined, exact));
  });

  it("rejects missing ownership, malformed metadata, and mismatched entry audience", () => {
    const base = reporterAttachment();
    for (const input of [
      { ...base, lifecycle: "available" as const, feedbackId: " " },
      { ...base, lifecycle: "available" as const, size: 0 },
      {
        ...base,
        lifecycle: "available" as const,
        size: 10 * 1024 * 1024 + 1,
      },
      {
        ...base,
        lifecycle: "available" as const,
        displayName: "../secret.png",
      },
      {
        ...base,
        lifecycle: "available" as const,
        displayName: "secret\u007f.png",
      },
      {
        ...base,
        lifecycle: "available" as const,
        audience: "reporter" as const,
        sourceEntry: { kind: "internal_note" as const, id: "note-1" },
      },
      {
        ...base,
        lifecycle: "available" as const,
        audience: "workspace" as const,
        sourceEntry: { kind: "visible_message" as const, id: "message-1" },
      },
    ]) {
      expect(() => createAttachmentRecord(input)).toThrow(
        expect.objectContaining<Partial<AttachmentPolicyError>>({
          code: "ATTACHMENT_CONFIGURATION_INVALID",
        }),
      );
    }
  });
});

describe("Attachment lifecycle binding", () => {
  it("BDD-ATT-LIFECYCLE-001 permits only an exact current workspace capability", () => {
    const hidden = transitionAttachmentLifecycle(reporterAttachment(), "soft_delete");
    const exact = {
      kind: "workspace_actor" as const,
      authorizedWorkspaceId: "workspace-a",
      authorizedProjectId: "project-a",
      canReadAttachments: true,
    };

    expect(authorizeAttachmentLifecycle(hidden, exact)).toEqual({
      attachmentId: "attachment-1",
      objectId: "private/object-1",
    });
    for (const authorization of [
      { ...exact, authorizedWorkspaceId: "workspace-b" },
      { ...exact, authorizedProjectId: "project-b" },
      { ...exact, canReadAttachments: false },
      { kind: "reporter" as const, authorizedFeedbackId: "feedback-1" },
      { kind: "public" as const },
    ]) {
      expectDenied(() => authorizeAttachmentLifecycle(hidden, authorization));
    }
    expectDenied(() => authorizeAttachmentLifecycle(undefined, exact));
  });

  it("hides immediately on soft deletion, restores before purge, and never restores after purge", () => {
    const attachment = reporterAttachment();
    const authorization = {
      kind: "reporter" as const,
      authorizedFeedbackId: "feedback-1",
    };

    const hidden = transitionAttachmentLifecycle(attachment, "soft_delete");
    expect(hidden.lifecycle).toBe("soft_deleted");
    expectDenied(() => authorizeAttachment(hidden, authorization));

    const restored = transitionAttachmentLifecycle(hidden, "restore");
    expect(restored.lifecycle).toBe("available");
    expect(authorizeAttachment(restored, authorization).objectId).toBe(
      "private/object-1",
    );

    const purged = transitionAttachmentLifecycle(restored, "purge");
    expect(purged.lifecycle).toBe("purged");
    expectDenied(() => authorizeAttachment(purged, authorization));
    expect(() => transitionAttachmentLifecycle(purged, "restore")).toThrow(
      expect.objectContaining<Partial<AttachmentPolicyError>>({
        code: "ATTACHMENT_LIFECYCLE_INVALID",
      }),
    );
  });

  it("keeps lifecycle operations idempotent only when their meaning is unchanged", () => {
    const attachment = reporterAttachment();
    const hidden = transitionAttachmentLifecycle(attachment, "soft_delete");

    expect(transitionAttachmentLifecycle(hidden, "soft_delete")).toBe(hidden);
    expect(transitionAttachmentLifecycle(attachment, "restore")).toBe(attachment);
    const purged = transitionAttachmentLifecycle(hidden, "purge");
    expect(transitionAttachmentLifecycle(purged, "purge")).toBe(purged);
    expect(() => transitionAttachmentLifecycle(purged, "soft_delete")).toThrow(
      expect.objectContaining<Partial<AttachmentPolicyError>>({
        code: "ATTACHMENT_LIFECYCLE_INVALID",
      }),
    );
    expect(() => transitionAttachmentLifecycle(attachment, "purge")).not.toThrow();
  });
});
