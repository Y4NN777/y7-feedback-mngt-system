export type AttachmentAudience = "reporter" | "workspace";
export type AttachmentLifecycle = "available" | "soft_deleted" | "purged";

export type AttachmentSourceEntry =
  | { readonly kind: "source_submission"; readonly id: string }
  | { readonly kind: "visible_message"; readonly id: string }
  | { readonly kind: "internal_note"; readonly id: string };

export interface AttachmentRecord {
  readonly id: string;
  readonly objectId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly audience: AttachmentAudience;
  readonly sourceEntry: AttachmentSourceEntry;
  readonly displayName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly lifecycle: AttachmentLifecycle;
}

export type AttachmentAuthorization =
  | { readonly kind: "public" }
  | { readonly kind: "reporter"; readonly authorizedFeedbackId: string }
  | {
      readonly kind: "workspace_actor";
      readonly authorizedWorkspaceId: string;
      readonly authorizedProjectId: string;
      readonly canReadAttachments: boolean;
    };

export interface AuthorizedAttachment {
  readonly attachmentId: string;
  readonly objectId: string;
}

export class AttachmentPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AttachmentPolicyError";
    this.code = code;
  }
}

const allowedMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain; charset=utf-8",
  "text/csv; charset=utf-8",
]);

function required(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AttachmentPolicyError("ATTACHMENT_CONFIGURATION_INVALID");
  }
  return normalized;
}

function unsafeName(value: string): boolean {
  if (/[\\/]/u.test(value)) return true;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function createAttachmentRecord(
  input: Omit<AttachmentRecord, "lifecycle"> & { readonly lifecycle?: "available" },
): AttachmentRecord {
  const id = required(input.id, 200);
  const objectId = required(input.objectId, 500);
  const feedbackId = required(input.feedbackId, 200);
  const workspaceId = required(input.workspaceId, 200);
  const projectId = required(input.projectId, 200);
  const displayName = required(input.displayName, 255);
  const mediaType = required(input.mediaType, 100);
  const sha256 = required(input.sha256, 200);
  const createdAt = required(input.createdAt, 40);
  const sourceEntryId = required(input.sourceEntry.id, 200);
  const expectedAudience =
    input.sourceEntry.kind === "internal_note" ? "workspace" : "reporter";

  if (
    !objectId.startsWith("private/") ||
    input.size < 1 ||
    input.size > 10 * 1024 * 1024 ||
    unsafeName(displayName) ||
    !allowedMediaTypes.has(mediaType) ||
    !/^[A-Za-z0-9_-]+$/u.test(sha256) ||
    !createdAt.endsWith("Z") ||
    Number.isNaN(Date.parse(createdAt)) ||
    input.audience !== expectedAudience
  ) {
    throw new AttachmentPolicyError("ATTACHMENT_CONFIGURATION_INVALID");
  }

  return {
    id,
    objectId,
    feedbackId,
    workspaceId,
    projectId,
    audience: input.audience,
    sourceEntry: { ...input.sourceEntry, id: sourceEntryId },
    displayName,
    mediaType,
    size: input.size,
    sha256,
    createdAt,
    lifecycle: "available",
  };
}

export function authorizeAttachment(
  attachment: AttachmentRecord | undefined,
  authorization: AttachmentAuthorization,
): AuthorizedAttachment {
  let authorized = false;
  if (attachment?.lifecycle === "available") {
    if (authorization.kind === "reporter") {
      authorized =
        attachment.audience === "reporter" &&
        attachment.feedbackId === authorization.authorizedFeedbackId;
    } else if (authorization.kind === "workspace_actor") {
      authorized =
        authorization.canReadAttachments &&
        attachment.workspaceId === authorization.authorizedWorkspaceId &&
        attachment.projectId === authorization.authorizedProjectId;
    }
  }
  if (!attachment || !authorized) {
    throw new AttachmentPolicyError("ATTACHMENT_ACCESS_DENIED");
  }
  return { attachmentId: attachment.id, objectId: attachment.objectId };
}

export function transitionAttachmentLifecycle(
  attachment: AttachmentRecord,
  operation: "soft_delete" | "restore" | "purge",
): AttachmentRecord {
  if (operation === "purge") {
    return attachment.lifecycle === "purged"
      ? attachment
      : { ...attachment, lifecycle: "purged" };
  }
  if (operation === "soft_delete") {
    if (attachment.lifecycle === "purged") {
      throw new AttachmentPolicyError("ATTACHMENT_LIFECYCLE_INVALID");
    }
    return attachment.lifecycle === "soft_deleted"
      ? attachment
      : { ...attachment, lifecycle: "soft_deleted" };
  }
  if (attachment.lifecycle === "purged") {
    throw new AttachmentPolicyError("ATTACHMENT_LIFECYCLE_INVALID");
  }
  return attachment.lifecycle === "available"
    ? attachment
    : { ...attachment, lifecycle: "available" };
}
