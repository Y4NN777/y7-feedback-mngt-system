import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AttachmentStagingGrant {
  readonly attachmentId: string;
  readonly objectId: string;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly displayName: string;
  readonly mediaType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif"
    | "application/pdf"
    | "text/plain; charset=utf-8"
    | "text/csv; charset=utf-8";
  readonly size: number;
  readonly sha256: string;
  readonly stagedAt: string;
}

export interface AttachmentStagingTokenCodec {
  issue(grant: AttachmentStagingGrant): string;
  verify(attachmentId: string, token: string): AttachmentStagingGrant;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const operationId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const maximumBytes = 10 * 1024 * 1024;
const mediaTypes = new Set<AttachmentStagingGrant["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain; charset=utf-8",
  "text/csv; charset=utf-8",
]);

function validInstant(value: string): boolean {
  return (
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function parse(value: unknown): AttachmentStagingGrant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("ATTACHMENT_STAGING_TOKEN_INVALID");
  }
  const candidate = value as Partial<AttachmentStagingGrant>;
  if (
    typeof candidate.attachmentId !== "string" ||
    !id.test(candidate.attachmentId) ||
    typeof candidate.objectId !== "string" ||
    !candidate.objectId.startsWith("private/") ||
    candidate.objectId.length > 500 ||
    typeof candidate.operationId !== "string" ||
    !operationId.test(candidate.operationId) ||
    typeof candidate.workspaceId !== "string" ||
    !id.test(candidate.workspaceId) ||
    typeof candidate.projectId !== "string" ||
    !id.test(candidate.projectId) ||
    typeof candidate.displayName !== "string" ||
    !candidate.displayName.trim() ||
    candidate.displayName.length > 255 ||
    typeof candidate.mediaType !== "string" ||
    !mediaTypes.has(candidate.mediaType) ||
    !Number.isSafeInteger(candidate.size) ||
    Number(candidate.size) < 1 ||
    Number(candidate.size) > maximumBytes ||
    typeof candidate.sha256 !== "string" ||
    !sha256.test(candidate.sha256) ||
    typeof candidate.stagedAt !== "string" ||
    !validInstant(candidate.stagedAt)
  ) {
    throw new Error("ATTACHMENT_STAGING_TOKEN_INVALID");
  }
  return candidate as AttachmentStagingGrant;
}

export function createAttachmentStagingTokenCodec(
  sensitive: AppwriteSensitivePersistence,
  options: {
    readonly tableId: string;
    readonly now: () => string;
    readonly ttlMs: number;
  },
): AttachmentStagingTokenCodec {
  if (
    !id.test(options.tableId) ||
    !Number.isSafeInteger(options.ttlMs) ||
    options.ttlMs < 1
  ) {
    throw new Error("ATTACHMENT_STAGING_TOKEN_INVALID");
  }
  const context = (attachmentId: string) => ({
    environment: sensitive.environment,
    tableId: options.tableId,
    rowId: attachmentId,
    field: "stagingToken",
  });
  return {
    issue(value) {
      const grant = parse(value);
      try {
        return sensitive.protector.seal(
          context(grant.attachmentId),
          JSON.stringify(grant),
        );
      } catch {
        throw new Error("ATTACHMENT_STAGING_TOKEN_INVALID");
      }
    },
    verify(attachmentId, token) {
      try {
        if (
          !id.test(attachmentId) ||
          typeof token !== "string" ||
          token.length > 10_000
        ) {
          throw new Error("invalid");
        }
        const grant = parse(
          JSON.parse(sensitive.protector.open(context(attachmentId), token)) as unknown,
        );
        const now = Date.parse(options.now());
        const stagedAt = Date.parse(grant.stagedAt);
        if (
          grant.attachmentId !== attachmentId ||
          !Number.isFinite(now) ||
          stagedAt > now ||
          now - stagedAt > options.ttlMs
        ) {
          throw new Error("invalid");
        }
        return grant;
      } catch {
        throw new Error("ATTACHMENT_STAGING_TOKEN_INVALID");
      }
    },
  };
}
