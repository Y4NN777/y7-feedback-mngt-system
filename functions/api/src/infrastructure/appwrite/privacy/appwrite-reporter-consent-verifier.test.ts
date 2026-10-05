import { describe, expect, it, vi } from "vitest";

import { createAppwriteReporterConsentVerifier } from "./appwrite-reporter-consent-verifier";

describe("Appwrite Reporter consent verifier", () => {
  it("BDD-ISSUE-PROOF-001 resolves scope only after accountless proof succeeds", async () => {
    const authorize = vi.fn().mockResolvedValue({
      status: "ok",
      feedbackId: "feedback_1",
    });
    const getRow = vi.fn().mockResolvedValue({
      $id: "feedback_1",
      reporterId: "reporter_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      deletedAt: null,
    });
    const verifier = createAppwriteReporterConsentVerifier(
      { authorize },
      { getRow },
      { databaseId: "feedback", feedbackTableId: "feedback_items" },
    );

    await expect(
      verifier.verify({ reference: "Y7-ABC123", proof: "proof" }),
    ).resolves.toEqual({
      status: "verified",
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    expect(getRow).toHaveBeenCalledAfter(authorize);
  });

  it.each(["denied", "retryable"] as const)(
    "BDD-ISSUE-PROOF-002 maps accountless %s without reading Feedback",
    async (status) => {
      const getRow = vi.fn();
      const verifier = createAppwriteReporterConsentVerifier(
        { authorize: vi.fn().mockResolvedValue({ status }) },
        { getRow },
        { databaseId: "feedback", feedbackTableId: "feedback_items" },
      );
      await expect(verifier.verify({ reference: "x", proof: "x" })).resolves.toEqual({
        status,
      });
      expect(getRow).not.toHaveBeenCalled();
    },
  );

  it("BDD-ISSUE-PROOF-003 fails closed for corrupt, deleted, or unavailable scope", async () => {
    const authorize = vi.fn().mockResolvedValue({
      status: "ok",
      feedbackId: "feedback_1",
    });
    for (const row of [
      null,
      { $id: "other" },
      {
        $id: "feedback_1",
        reporterId: "bad id",
        workspaceId: "workspace_1",
        projectId: "project_1",
      },
      {
        $id: "feedback_1",
        reporterId: "reporter_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        deletedAt: "2026-08-28T00:00:00.000Z",
      },
    ]) {
      const verifier = createAppwriteReporterConsentVerifier(
        { authorize },
        { getRow: vi.fn().mockResolvedValue(row) },
        { databaseId: "feedback", feedbackTableId: "feedback_items" },
      );
      await expect(
        verifier.verify({ reference: "Y7-ABC123", proof: "proof" }),
      ).resolves.toEqual({ status: "retryable" });
    }

    const unavailable = createAppwriteReporterConsentVerifier(
      { authorize },
      { getRow: vi.fn().mockRejectedValue(new Error("unavailable")) },
      { databaseId: "feedback", feedbackTableId: "feedback_items" },
    );
    await expect(
      unavailable.verify({ reference: "Y7-ABC123", proof: "proof" }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("BDD-ISSUE-PROOF-004 rejects malformed schema identifiers", () => {
    expect(() =>
      createAppwriteReporterConsentVerifier(
        { authorize: vi.fn() },
        { getRow: vi.fn() },
        { databaseId: "feedback", feedbackTableId: "bad id" },
      ),
    ).toThrow("APPWRITE_REPORTER_CONSENT_SCHEMA_INVALID");
  });
});
