import { describe, expect, it, vi } from "vitest";

import type { AttachmentDownload } from "./attachment-download";
import {
  createWorkspaceAttachmentDownload,
  type AppwritePrincipalVerifier,
  type WorkspaceAttachmentScopeResolver,
} from "./workspace-attachment-download";

const request = {
  jwt: "jwt-value",
  workspaceId: "workspace-a",
  projectId: "project-a",
  attachmentId: "attachment-a",
};

function setup() {
  const verify = vi.fn<AppwritePrincipalVerifier["verify"]>(() =>
    Promise.resolve({ status: "verified", principalId: "user-a" }),
  );
  const resolve = vi.fn<WorkspaceAttachmentScopeResolver["resolve"]>(() =>
    Promise.resolve({
      status: "authorized",
      authorization: {
        kind: "workspace_actor",
        authorizedWorkspaceId: "workspace-a",
        authorizedProjectId: "project-a",
        canReadAttachments: true,
      },
    }),
  );
  const download = vi.fn<AttachmentDownload>(() =>
    Promise.resolve({
      status: "available",
      attachmentId: "attachment-a",
      displayName: "internal.txt",
      mediaType: "text/plain; charset=utf-8",
      bytes: new TextEncoder().encode("internal evidence"),
    }),
  );
  return {
    coordinator: createWorkspaceAttachmentDownload({ verify }, { resolve }, download),
    download,
    resolve,
    verify,
  };
}

describe("Workspace Attachment download coordination", () => {
  it("BDD-AUTH-ATT-001 derives the principal and scope before private download", async () => {
    const target = setup();

    await expect(target.coordinator(request)).resolves.toMatchObject({
      status: "available",
      attachmentId: "attachment-a",
    });
    expect(target.verify).toHaveBeenCalledWith("jwt-value");
    expect(target.resolve).toHaveBeenCalledWith({
      principalId: "user-a",
      workspaceId: "workspace-a",
      projectId: "project-a",
    });
    expect(target.download).toHaveBeenCalledWith("attachment-a", {
      kind: "workspace_actor",
      authorizedWorkspaceId: "workspace-a",
      authorizedProjectId: "project-a",
      canReadAttachments: true,
    });
  });

  it.each([
    { status: "denied" as const },
    {
      status: "verified" as const,
      principalId: "user-a",
      claimedPrincipalId: "forged",
    },
  ])(
    "BDD-AUTH-ATT-002 denies invalid or forged identity without scope access %#",
    async (identity) => {
      const target = setup();
      if (identity.status === "denied") {
        target.verify.mockResolvedValueOnce(identity);
      }
      await expect(
        target.coordinator({
          ...request,
          ...(identity.claimedPrincipalId === undefined
            ? {}
            : { claimedPrincipalId: identity.claimedPrincipalId }),
        }),
      ).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
      expect(target.resolve).not.toHaveBeenCalled();
      expect(target.download).not.toHaveBeenCalled();
    },
  );

  it.each(["denied", "retryable"] as const)(
    "BDD-AUTH-ATT-003 propagates %s scope resolution without file access",
    async (status) => {
      const target = setup();
      target.resolve.mockResolvedValueOnce({ status });

      await expect(target.coordinator(request)).resolves.toEqual(
        status === "denied"
          ? { status: "denied", code: "ATTACHMENT_ACCESS_DENIED" }
          : { status: "retryable", code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE" },
      );
      expect(target.download).not.toHaveBeenCalled();
    },
  );

  it("maps identity authority failure to retryable and hides thrown details", async () => {
    const retryable = setup();
    retryable.verify.mockResolvedValueOnce({ status: "retryable" });
    await expect(retryable.coordinator(request)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });

    const thrown = setup();
    thrown.verify.mockRejectedValueOnce(new Error("private auth detail"));
    await expect(thrown.coordinator(request)).resolves.toEqual({
      status: "retryable",
      code: "ATTACHMENT_DOWNLOAD_UNAVAILABLE",
    });
  });

  it("denies malformed request identifiers before verifying the JWT", async () => {
    for (const malformed of [
      { ...request, jwt: "" },
      { ...request, workspaceId: "bad/id" },
      { ...request, projectId: "" },
      { ...request, attachmentId: "a".repeat(201) },
      { ...request, claimedPrincipalId: "bad/id" },
    ]) {
      const target = setup();
      await expect(target.coordinator(malformed)).resolves.toEqual({
        status: "denied",
        code: "ATTACHMENT_ACCESS_DENIED",
      });
      expect(target.verify).not.toHaveBeenCalled();
    }
  });
});
