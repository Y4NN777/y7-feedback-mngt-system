import type { AccessRequest } from "@y7-feedback/domain";

import type { AccountlessAccessCoordinator } from "./accountless-access.js";
import type {
  AttachmentDownloadOutcome,
  AttachmentDownload,
} from "./attachment-download.js";

export interface ReporterAttachmentDownloadRequest extends AccessRequest {
  readonly attachmentId: string;
}

export type ReporterAttachmentDownloadOutcome = AttachmentDownloadOutcome;

export type ReporterAttachmentDownload = (
  request: ReporterAttachmentDownloadRequest,
) => Promise<ReporterAttachmentDownloadOutcome>;

const denied: ReporterAttachmentDownloadOutcome = {
  status: "denied",
  code: "ATTACHMENT_ACCESS_DENIED",
};

const unavailable: ReporterAttachmentDownloadOutcome = {
  status: "retryable",
  code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
};

export function createReporterAttachmentDownload(
  access: Pick<AccountlessAccessCoordinator, "authorize">,
  download: AttachmentDownload,
): ReporterAttachmentDownload {
  return async (request) => {
    try {
      const authorization = await access.authorize({
        reference: request.reference,
        ...(request.proof === undefined ? {} : { proof: request.proof }),
      });
      if (authorization.status === "denied") return denied;
      if (authorization.status === "retryable") return unavailable;

      const outcome = await download(request.attachmentId, {
        kind: "reporter",
        authorizedFeedbackId: authorization.feedbackId,
      });
      return outcome.status === "denied" ? denied : outcome;
    } catch {
      return unavailable;
    }
  };
}
