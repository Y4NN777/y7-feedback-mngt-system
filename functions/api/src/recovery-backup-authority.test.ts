import { describe, expect, it } from "vitest";

import { assertRecoveryBackupAuthority } from "./recovery-backup-authority";

describe("Recovery backup environment authority", () => {
  it("BDD-REL-415 accepts an isolated Production source", () => {
    expect(
      assertRecoveryBackupAuthority({
        sourceEnvironment: "production",
        backendEnvironment: "production",
        projectId: "production-project",
        previewProjectId: "preview-project",
      }),
    ).toEqual({ environment: "production", projectId: "production-project" });
  });

  it("accepts a consistently declared Preview source", () => {
    expect(
      assertRecoveryBackupAuthority({
        sourceEnvironment: "preview",
        backendEnvironment: "preview",
        projectId: "preview-project",
      }),
    ).toEqual({ environment: "preview", projectId: "preview-project" });
  });

  it.each([
    { sourceEnvironment: "invalid", backendEnvironment: "production" },
    { sourceEnvironment: "production", backendEnvironment: "preview" },
    { sourceEnvironment: "preview", backendEnvironment: "production" },
  ])("BDD-REL-416 rejects an inconsistent environment declaration %#", (input) => {
    expect(() =>
      assertRecoveryBackupAuthority({
        ...input,
        projectId: "production-project",
        previewProjectId: "preview-project",
      }),
    ).toThrow("RECOVERY_ENVIRONMENT_AUTHORITY_INVALID");
  });

  it.each([undefined, "", "production-project"])(
    "BDD-REL-417 rejects missing or shared Preview authority in Production %#",
    (previewProjectId) => {
      expect(() =>
        assertRecoveryBackupAuthority({
          sourceEnvironment: "production",
          backendEnvironment: "production",
          projectId: "production-project",
          previewProjectId,
        }),
      ).toThrow("RECOVERY_ENVIRONMENT_COLLISION");
    },
  );

  it.each(["", "bad/id", "x".repeat(37)])(
    "rejects an invalid Appwrite project identifier %#",
    (projectId) => {
      expect(() =>
        assertRecoveryBackupAuthority({
          sourceEnvironment: "preview",
          backendEnvironment: "preview",
          projectId,
        }),
      ).toThrow("RECOVERY_ENVIRONMENT_AUTHORITY_INVALID");
    },
  );
});
