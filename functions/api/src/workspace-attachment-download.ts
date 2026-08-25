import type { AttachmentAuthorization } from "@y7-feedback/domain";

import type {
  AttachmentDownload,
  AttachmentDownloadOutcome,
} from "./attachment-download.js";

export type AppwritePrincipalVerification =
  | { readonly status: "verified"; readonly principalId: string }
  | { readonly status: "denied" }
  | { readonly status: "retryable" };

export interface AppwritePrincipalVerifier {
  verify(jwt: string): Promise<AppwritePrincipalVerification>;
}

export type WorkspaceAttachmentScopeResolution =
  | {
      readonly status: "authorized";
      readonly authorization: Extract<
        AttachmentAuthorization,
        { readonly kind: "workspace_actor" }
      >;
    }
  | { readonly status: "denied" }
  | { readonly status: "retryable" };

export interface WorkspaceAttachmentScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<WorkspaceAttachmentScopeResolution>;
}

export interface WorkspaceAttachmentDownloadRequest {
  readonly jwt: string;
  readonly claimedPrincipalId?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly attachmentId: string;
}

export type WorkspaceAttachmentDownload = (
  request: WorkspaceAttachmentDownloadRequest,
) => Promise<AttachmentDownloadOutcome>;

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const denied: AttachmentDownloadOutcome = {
  status: "denied",
  code: "ATTACHMENT_ACCESS_DENIED",
};
const unavailable: AttachmentDownloadOutcome = {
  status: "retryable",
  code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
};

function validRequest(request: WorkspaceAttachmentDownloadRequest): boolean {
  return (
    request.jwt.length >= 1 &&
    request.jwt.length <= 4_096 &&
    !/\s/u.test(request.jwt) &&
    appwriteId.test(request.workspaceId) &&
    appwriteId.test(request.projectId) &&
    request.attachmentId.trim().length > 0 &&
    request.attachmentId.length <= 200 &&
    (request.claimedPrincipalId === undefined ||
      appwriteId.test(request.claimedPrincipalId))
  );
}

export function createWorkspaceAttachmentDownload(
  principal: AppwritePrincipalVerifier,
  scope: WorkspaceAttachmentScopeResolver,
  download: AttachmentDownload,
): WorkspaceAttachmentDownload {
  return async (request) => {
    if (!validRequest(request)) return denied;

    try {
      const identity = await principal.verify(request.jwt);
      if (identity.status === "denied") return denied;
      if (identity.status === "retryable") return unavailable;
      if (
        request.claimedPrincipalId !== undefined &&
        request.claimedPrincipalId !== identity.principalId
      ) {
        return denied;
      }

      const resolved = await scope.resolve({
        principalId: identity.principalId,
        workspaceId: request.workspaceId,
        projectId: request.projectId,
      });
      if (resolved.status === "denied") return denied;
      if (resolved.status === "retryable") return unavailable;
      return await download(request.attachmentId, resolved.authorization);
    } catch {
      return unavailable;
    }
  };
}
