import { describe, expect, it, vi } from "vitest";

import { acceptAttachmentEvidence } from "./attachment-evidence-retry";
import type { AttachmentAcceptanceCommand, AttachmentSaga } from "./attachment-saga";

const command: AttachmentAcceptanceCommand = {
  operationId: "123e4567-e89b-42d3-a456-426614174011",
  feedbackId: "feedback",
  workspaceId: "workspace",
  projectId: "project",
  audience: "reporter",
  sourceEntry: { kind: "source_submission", id: "source" },
  files: [
    {
      bytes: new TextEncoder().encode("clean"),
      clientName: "clean.txt",
      clientMediaType: "text/plain",
    },
  ],
};

describe("attachment evidence retry", () => {
  it("retries a retryable acceptance with the same idempotency command", async () => {
    const accept = vi
      .fn<AttachmentSaga["accept"]>()
      .mockResolvedValueOnce({ status: "retryable", code: "ATTACHMENT_UNAVAILABLE" })
      .mockResolvedValueOnce({
        status: "accepted",
        feedbackId: command.feedbackId,
        attachmentIds: ["attachment"],
      });
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      acceptAttachmentEvidence({ accept, sweep: vi.fn() }, command, delay),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(accept).toHaveBeenNthCalledWith(1, command);
    expect(accept).toHaveBeenNthCalledWith(2, command);
    expect(delay).toHaveBeenCalledWith(1_000);
  });

  it("does not retry a policy rejection", async () => {
    const accept = vi
      .fn<AttachmentSaga["accept"]>()
      .mockResolvedValue({ status: "rejected", code: "ATTACHMENT_REJECTED" });

    await expect(
      acceptAttachmentEvidence({ accept, sweep: vi.fn() }, command),
    ).resolves.toEqual({ status: "rejected", code: "ATTACHMENT_REJECTED" });
    expect(accept).toHaveBeenCalledOnce();
  });
});
