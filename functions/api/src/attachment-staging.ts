import type { PrivateAttachmentStorage } from "./attachment-saga.js";
import type {
  AttachmentCandidate,
  AttachmentValidationOutcome,
} from "./attachment-validation.js";
import type { AttachmentStagingTokenCodec } from "./attachment-staging-token.js";

export interface AttachmentStagingCommand {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly file: AttachmentCandidate;
}

export type AttachmentStagingOutcome =
  | {
      readonly status: "staged";
      readonly attachmentId: string;
      readonly token: string;
      readonly displayName: string;
    }
  | { readonly status: "rejected"; readonly code: "ATTACHMENT_REJECTED" }
  | { readonly status: "retryable"; readonly code: "ATTACHMENT_UNAVAILABLE" };

const operationId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const scopedId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

export function createAttachmentStaging(
  storage: PrivateAttachmentStorage,
  tokens: AttachmentStagingTokenCodec,
  dependencies: {
    readonly validate: (
      candidate: AttachmentCandidate,
    ) => Promise<AttachmentValidationOutcome>;
    readonly createAttachmentId: () => string;
    readonly createObjectId: () => string;
    readonly now: () => string;
  },
): { stage(command: AttachmentStagingCommand): Promise<AttachmentStagingOutcome> } {
  return {
    async stage(command) {
      if (
        !operationId.test(command.operationId) ||
        !scopedId.test(command.workspaceId) ||
        !scopedId.test(command.projectId)
      ) {
        return { status: "rejected", code: "ATTACHMENT_REJECTED" };
      }
      let validation: AttachmentValidationOutcome;
      try {
        validation = await dependencies.validate(command.file);
      } catch {
        return { status: "retryable", code: "ATTACHMENT_UNAVAILABLE" };
      }
      if (validation.status === "rejected") return validation;
      if (validation.status === "retryable") {
        return { status: "retryable", code: "ATTACHMENT_UNAVAILABLE" };
      }

      const attachmentId = dependencies.createAttachmentId().trim();
      const objectId = dependencies.createObjectId().trim();
      const stagedAt = dependencies.now();
      if (
        !scopedId.test(attachmentId) ||
        !objectId.startsWith("private/") ||
        objectId.length > 500
      ) {
        return { status: "retryable", code: "ATTACHMENT_UNAVAILABLE" };
      }
      try {
        await storage.stage({
          objectId,
          operationId: command.operationId,
          stagedAt,
          bytes: command.file.bytes,
          visibility: "private",
        });
        const token = tokens.issue({
          attachmentId,
          objectId,
          operationId: command.operationId,
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          displayName: validation.metadata.displayName,
          mediaType: validation.metadata.mediaType,
          size: validation.metadata.size,
          sha256: validation.metadata.sha256,
          stagedAt,
        });
        return {
          status: "staged",
          attachmentId,
          token,
          displayName: validation.metadata.displayName,
        };
      } catch {
        try {
          await storage.remove(objectId);
        } catch {
          // The sweeper remains the final orphan safety net.
        }
        return { status: "retryable", code: "ATTACHMENT_UNAVAILABLE" };
      }
    },
  };
}
