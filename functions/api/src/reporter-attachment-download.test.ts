import { describe, expect, it, vi } from "vitest";

import type { AccountlessAccessCoordinator } from "./accountless-access";
import type { AttachmentDownload } from "./attachment-download";
import { createReporterAttachmentDownload } from "./reporter-attachment-download";

const request = {
  attachmentId: "attachment-1",
  reference: "Y7-2026-000001",
  proof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
};

function access(
  outcome: Awaited<ReturnType<AccountlessAccessCoordinator["authorize"]>>,
) {
  return {
    authorize: vi.fn(() => Promise.resolve(outcome)),
  } as Pick<AccountlessAccessCoordinator, "authorize">;
}

describe("Reporter attachment download coordination", () => {
  it("BDD-ATT-DEPLOYED-002 reads bytes only after proof-derived Feedback authorization", async () => {
    const authorization = access({ status: "ok", feedbackId: "feedback-1" });
    const download = vi.fn<AttachmentDownload>(() =>
      Promise.resolve({
        status: "available",
        attachmentId: "attachment-1",
        displayName: "evidence.txt",
        mediaType: "text/plain; charset=utf-8",
        bytes: new TextEncoder().encode("evidence"),
      }),
    );

    const outcome = await createReporterAttachmentDownload(
      authorization,
      download,
    )(request);

    expect(authorization.authorize).toHaveBeenCalledWith({
      reference: request.reference,
      proof: request.proof,
    });
    expect(download).toHaveBeenCalledWith("attachment-1", {
      kind: "reporter",
      authorizedFeedbackId: "feedback-1",
    });
    expect(outcome).toMatchObject({
      status: "available",
      attachmentId: "attachment-1",
      displayName: "evidence.txt",
    });
  });

  it("BDD-ATT-DEPLOYED-003 returns one denial before file access for invalid or sibling proof", async () => {
    const authorization = access({ status: "denied", code: "ACCESS_DENIED" });
    const download = vi.fn<AttachmentDownload>();

    await expect(
      createReporterAttachmentDownload(authorization, download)(request),
    ).resolves.toEqual({ status: "denied", code: "ATTACHMENT_ACCESS_DENIED" });
    expect(download).not.toHaveBeenCalled();
  });

  it("maps missing/sibling Attachment to the same denial and dependency failures to retry", async () => {
    const authorization = access({ status: "ok", feedbackId: "feedback-1" });
    const denied = vi.fn<AttachmentDownload>(() =>
      Promise.resolve({ status: "denied", code: "ATTACHMENT_ACCESS_DENIED" }),
    );
    const retryable = vi.fn<AttachmentDownload>(() =>
      Promise.resolve({
        status: "retryable",
        code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
      }),
    );

    await expect(
      createReporterAttachmentDownload(authorization, denied)(request),
    ).resolves.toEqual({ status: "denied", code: "ATTACHMENT_ACCESS_DENIED" });
    await expect(
      createReporterAttachmentDownload(authorization, retryable)(request),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });

    const unavailableAccess = access({
      status: "retryable",
      code: "ACCESS_UNAVAILABLE",
    });
    await expect(
      createReporterAttachmentDownload(unavailableAccess, denied)(request),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
  });

  it("fails closed when authorization or file capabilities throw", async () => {
    const failedAccess = {
      authorize: vi.fn(() => Promise.reject(new Error("private database detail"))),
    };
    const denied = vi.fn<AttachmentDownload>();
    await expect(
      createReporterAttachmentDownload(
        failedAccess,
        denied,
      )({
        attachmentId: request.attachmentId,
        reference: request.reference,
      }),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
    expect(failedAccess.authorize).toHaveBeenCalledWith({
      reference: request.reference,
    });

    const failedDownload = vi.fn<AttachmentDownload>(() =>
      Promise.reject(new Error("private storage detail")),
    );
    await expect(
      createReporterAttachmentDownload(
        access({ status: "ok", feedbackId: "feedback-1" }),
        failedDownload,
      )(request),
    ).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
  });
});
