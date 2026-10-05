import {
  AttachmentPolicyError,
  authorizeAttachmentLifecycle,
  transitionAttachmentLifecycle,
  type AttachmentAuthorization,
  type AttachmentLifecycle,
  type AttachmentRecord,
} from "@y7-feedback/domain";

export interface AttachmentLifecycleRepository {
  findById(attachmentId: string): Promise<AttachmentRecord | undefined>;
  compareAndSetLifecycle(
    attachmentId: string,
    expected: AttachmentLifecycle,
    next: AttachmentLifecycle,
  ): Promise<boolean>;
}

export interface AttachmentLifecycleStorage {
  remove(objectId: string): Promise<void>;
}

export interface AttachmentLifecycleCommand {
  readonly attachmentId: string;
  readonly authorization: AttachmentAuthorization;
  readonly operation: "soft_delete" | "restore" | "purge";
}

export type AttachmentLifecycleOutcome =
  | { readonly status: "ok"; readonly lifecycle: AttachmentLifecycle }
  | { readonly status: "denied"; readonly code: "ATTACHMENT_ACCESS_DENIED" }
  | {
      readonly status: "rejected";
      readonly code: "ATTACHMENT_LIFECYCLE_INVALID";
    }
  | {
      readonly status: "retryable";
      readonly code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE";
    };

export interface AttachmentLifecycleCoordinator {
  transition(command: AttachmentLifecycleCommand): Promise<AttachmentLifecycleOutcome>;
}

const denied: AttachmentLifecycleOutcome = {
  status: "denied",
  code: "ATTACHMENT_ACCESS_DENIED",
};
const unavailable: AttachmentLifecycleOutcome = {
  status: "retryable",
  code: "ATTACHMENT_LIFECYCLE_UNAVAILABLE",
};

export function createAttachmentLifecycleCoordinator(
  repository: AttachmentLifecycleRepository,
  storage: AttachmentLifecycleStorage,
): AttachmentLifecycleCoordinator {
  return {
    async transition(command) {
      if (!command.attachmentId.trim() || command.attachmentId.length > 200) {
        return denied;
      }

      let attachment: AttachmentRecord | undefined;
      let transitioned: AttachmentRecord;
      try {
        attachment = await repository.findById(command.attachmentId);
        authorizeAttachmentLifecycle(attachment, command.authorization);
        const authorizedAttachment = attachment as AttachmentRecord;
        attachment = authorizedAttachment;
        transitioned = transitionAttachmentLifecycle(
          authorizedAttachment,
          command.operation,
        );
      } catch (error: unknown) {
        if (error instanceof AttachmentPolicyError) {
          return error.code === "ATTACHMENT_LIFECYCLE_INVALID"
            ? { status: "rejected", code: "ATTACHMENT_LIFECYCLE_INVALID" }
            : denied;
        }
        return unavailable;
      }

      try {
        const updated = await repository.compareAndSetLifecycle(
          attachment.id,
          attachment.lifecycle,
          transitioned.lifecycle,
        );
        if (!updated) return unavailable;
        if (transitioned.lifecycle === "purged") {
          await storage.remove(transitioned.objectId);
        }
        return { status: "ok", lifecycle: transitioned.lifecycle };
      } catch {
        return unavailable;
      }
    },
  };
}
