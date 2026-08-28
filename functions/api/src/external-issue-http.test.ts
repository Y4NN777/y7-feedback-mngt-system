/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies coordinator method spies by reference. */
import { describe, expect, it, vi } from "vitest";

import { createExternalIssueHttp } from "./external-issue-http";
import type { ExternalIssueCoordinator } from "./external-issue-coordination";

function coordinator(): ExternalIssueCoordinator {
  return {
    requestLink: vi.fn().mockResolvedValue({
      status: "ok",
      result: {
        status: "accepted",
        linkId: "link_1",
        synchronizationState: "pending",
      },
    }),
    grantConsent: vi.fn().mockResolvedValue({
      status: "ok",
      consent: { version: 1, state: "active" },
    }),
    revokeConsent: vi.fn().mockResolvedValue({
      status: "ok",
      consent: { version: 2, state: "revoked" },
    }),
  };
}

describe("External issue HTTP", () => {
  it("BDD-ISSUE-HTTP-009 parses a trusted Workspace link request", async () => {
    const useCase = coordinator();
    const http = createExternalIssueHttp(useCase);

    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: { authorization: "Bearer jwt" },
        body: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
          consentVersion: 1,
        },
      }),
    ).resolves.toEqual({
      statusCode: 201,
      body: {
        status: "accepted",
        result: {
          status: "accepted",
          linkId: "link_1",
          synchronizationState: "pending",
        },
      },
    });
    expect(useCase.requestLink).toHaveBeenCalledWith(
      expect.objectContaining({
        jwt: "jwt",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    );
  });

  it("BDD-ISSUE-HTTP-010 parses Reporter grant and revocation proof", async () => {
    const useCase = coordinator();
    const http = createExternalIssueHttp(useCase);
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/feedback/publication-consent/grant",
        headers: { Authorization: "FeedbackProof proof" },
        body: {
          operationId: "consent_grant_1",
          reference: "Y7-ABC123",
          disclosureVersion: "public-issue-v1",
          audience: "github:repository_1",
        },
      }),
    ).resolves.toMatchObject({ statusCode: 201 });
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/feedback/publication-consent/revoke",
        headers: { authorization: "FeedbackProof proof" },
        body: { operationId: "consent_revoke_1", reference: "Y7-ABC123" },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(useCase.grantConsent).toHaveBeenCalledWith(
      expect.objectContaining({ proof: "proof", audience: "github:repository_1" }),
    );
    expect(useCase.revokeConsent).toHaveBeenCalledWith(
      expect.objectContaining({ proof: "proof", operationId: "consent_revoke_1" }),
    );
  });

  it.each([
    ["denied", 404, "ERR-ISSUE-DENIED"],
    ["conflict", 409, "ERR-ISSUE-CONFLICT"],
    ["retryable", 503, "ERR-ISSUE-RETRYABLE"],
  ] as const)("BDD-ISSUE-HTTP-011 maps %s", async (status, statusCode, error) => {
    const useCase = coordinator();
    vi.mocked(useCase.requestLink).mockResolvedValue({ status });
    await expect(
      createExternalIssueHttp(useCase).handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: { authorization: "Bearer jwt" },
        body: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
        },
      }),
    ).resolves.toEqual({ statusCode, body: { error } });
  });

  it("BDD-ISSUE-HTTP-013 maps replay and Reporter failures", async () => {
    const useCase = coordinator();
    vi.mocked(useCase.requestLink).mockResolvedValue({
      status: "ok",
      result: {
        status: "replayed",
        linkId: "link_1",
        synchronizationState: "pending",
      },
    });
    vi.mocked(useCase.grantConsent).mockResolvedValue({ status: "conflict" });
    const http = createExternalIssueHttp(useCase);
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: { authorization: "Bearer jwt" },
        body: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
        },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      http.handle({
        method: "POST",
        path: "/v1/feedback/publication-consent/grant",
        headers: { authorization: "FeedbackProof proof" },
        body: {
          operationId: "consent_1",
          reference: "Y7-ABC123",
          disclosureVersion: "public-issue-v1",
          audience: "github:repository_1",
        },
      }),
    ).resolves.toEqual({
      statusCode: 409,
      body: { error: "ERR-ISSUE-CONFLICT" },
    });
  });

  it("BDD-ISSUE-HTTP-012 rejects confused deputies and malformed bodies", async () => {
    const http = createExternalIssueHttp(coordinator());
    for (const request of [
      {
        method: "GET",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: {},
      },
      {
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: {},
        body: {},
      },
      {
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/external-issue-link",
        headers: { authorization: "Bearer jwt", "x-appwrite-user-id": "forged" },
        body: {},
      },
      {
        method: "POST",
        path: "/v1/feedback/publication-consent/grant",
        headers: {},
        body: {},
      },
      {
        method: "POST",
        path: "/v1/feedback/publication-consent/grant",
        headers: { authorization: "Bearer wrong-kind" },
        body: {},
      },
      {
        method: "POST",
        path: "/v1/feedback/publication-consent/revoke",
        headers: { authorization: "FeedbackProof proof" },
        body: { operationId: "x", reference: "x", unexpected: true },
      },
    ]) {
      await expect(http.handle(request)).resolves.toEqual({
        statusCode: 404,
        body: { error: "ERR-ISSUE-DENIED" },
      });
    }
    await expect(
      http.handle({ method: "POST", path: "/unrelated", headers: {}, body: {} }),
    ).resolves.toBeUndefined();
  });
});
