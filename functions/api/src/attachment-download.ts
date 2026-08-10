import {
  authorizeAttachment,
  type AttachmentAuthorization,
  type AttachmentRecord,
} from "@y7-feedback/domain";

export interface AttachmentMetadataReader {
  findById(attachmentId: string): Promise<AttachmentRecord | undefined>;
}

export interface PrivateAttachmentReader {
  read(objectId: string): Promise<Uint8Array>;
}

export type AttachmentDownloadOutcome =
  | {
      readonly status: "available";
      readonly attachmentId: string;
      readonly displayName: string;
      readonly mediaType: string;
      readonly bytes: Uint8Array;
    }
  | { readonly status: "denied"; readonly code: "ATTACHMENT_ACCESS_DENIED" }
  | {
      readonly status: "retryable";
      readonly code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE";
    };

export type AttachmentDownload = (
  attachmentId: string,
  authorization: AttachmentAuthorization,
) => Promise<AttachmentDownloadOutcome>;

const denied: AttachmentDownloadOutcome = {
  status: "denied",
  code: "ATTACHMENT_ACCESS_DENIED",
};

const unavailable: AttachmentDownloadOutcome = {
  status: "retryable",
  code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
};

export function createAttachmentDownload(
  metadata: AttachmentMetadataReader,
  storage: PrivateAttachmentReader,
): AttachmentDownload {
  return async (attachmentId, authorization) => {
    if (!attachmentId.trim() || attachmentId.length > 200) return denied;

    let attachment: AttachmentRecord | undefined;
    try {
      attachment = await metadata.findById(attachmentId);
    } catch {
      return unavailable;
    }
    if (!attachment) return denied;

    let objectId: string;
    try {
      objectId = authorizeAttachment(attachment, authorization).objectId;
    } catch {
      return denied;
    }

    try {
      const bytes = await storage.read(objectId);
      return {
        status: "available",
        attachmentId: attachment.id,
        displayName: attachment.displayName,
        mediaType: attachment.mediaType,
        bytes,
      };
    } catch {
      return unavailable;
    }
  };
}
