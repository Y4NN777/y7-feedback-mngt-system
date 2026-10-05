import { describe, expect, it, vi } from "vitest";

import { createAttachmentStaging } from "./attachment-staging";
import type { AttachmentValidationOutcome } from "./attachment-validation";

const command = {
  operationId: "123e4567-e89b-42d3-a456-426614174000",
  workspaceId: "workspace_1",
  projectId: "project_1",
  file: {
    bytes: new TextEncoder().encode("evidence"),
    clientName: "evidence.txt",
    clientMediaType: "text/plain",
  },
} as const;
const accepted: AttachmentValidationOutcome = {
  status: "accepted",
  metadata: {
    format: "txt",
    mediaType: "text/plain; charset=utf-8",
    size: 8,
    sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    displayName: "evidence.txt",
  },
};

function setup(validation: AttachmentValidationOutcome = accepted) {
  const stage = vi.fn(() => Promise.resolve());
  const remove = vi.fn(() => Promise.resolve());
  const issue = vi.fn(() => "encrypted-token");
  const target = createAttachmentStaging(
    { stage, remove, listStagedBefore: vi.fn() },
    { issue, verify: vi.fn() },
    {
      validate: vi.fn(() => Promise.resolve(validation)),
      createAttachmentId: () => "attachment_1",
      createObjectId: () => "private/object_1",
      now: () => "2026-09-11T00:00:00.000Z",
    },
  );
  return { issue, remove, stage, target };
}

describe("public Attachment staging", () => {
  it("BDD-ATT-UC03-004 validates bytes before private staging and token issuance", async () => {
    const candidate = setup();

    await expect(candidate.target.stage(command)).resolves.toEqual({
      status: "staged",
      attachmentId: "attachment_1",
      token: "encrypted-token",
      displayName: "evidence.txt",
    });
    expect(candidate.stage).toHaveBeenCalledWith({
      objectId: "private/object_1",
      operationId: command.operationId,
      stagedAt: "2026-09-11T00:00:00.000Z",
      bytes: command.file.bytes,
      visibility: "private",
    });
    expect(candidate.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "attachment_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        displayName: "evidence.txt",
      }),
    );
  });

  it("BDD-ATT-UC03-005 rejects unsafe content without durable staging", async () => {
    const candidate = setup({ status: "rejected", code: "ATTACHMENT_REJECTED" });

    await expect(candidate.target.stage(command)).resolves.toEqual({
      status: "rejected",
      code: "ATTACHMENT_REJECTED",
    });
    expect(candidate.stage).not.toHaveBeenCalled();
    expect(candidate.issue).not.toHaveBeenCalled();
  });

  it("BDD-ATT-UC03-006 removes staged bytes if the grant cannot be issued", async () => {
    const candidate = setup();
    candidate.issue.mockImplementation(() => {
      throw new Error("token failure");
    });

    await expect(candidate.target.stage(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });
    expect(candidate.remove).toHaveBeenCalledWith("private/object_1");
  });

  it("fails closed for invalid scope, scanner outage and invalid generated identity", async () => {
    const invalid = setup();
    await expect(
      invalid.target.stage({ ...command, workspaceId: "bad/id" }),
    ).resolves.toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });

    const unavailable = setup({
      status: "retryable",
      code: "VALIDATION_UNAVAILABLE",
    });
    await expect(unavailable.target.stage(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });

    const scannerFailure = createAttachmentStaging(
      { stage: vi.fn(), remove: vi.fn(), listStagedBefore: vi.fn() },
      { issue: vi.fn(), verify: vi.fn() },
      {
        validate: () => Promise.reject(new Error("scanner outage")),
        createAttachmentId: () => "attachment_1",
        createObjectId: () => "private/object_1",
        now: () => "2026-09-11T00:00:00.000Z",
      },
    );
    await expect(scannerFailure.stage(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });

    const invalidIdentity = createAttachmentStaging(
      { stage: vi.fn(), remove: vi.fn(), listStagedBefore: vi.fn() },
      { issue: vi.fn(), verify: vi.fn() },
      {
        validate: () => Promise.resolve(accepted),
        createAttachmentId: () => "bad/id",
        createObjectId: () => "public/object_1",
        now: () => "2026-09-11T00:00:00.000Z",
      },
    );
    await expect(invalidIdentity.stage(command)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_UNAVAILABLE",
    });
  });
});
