/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects capability mocks without invoking detached methods. */
import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import {
  createExternalIssueCoordinator,
  type ExternalIssueCoordinatorDependencies,
  type ExternalIssuePersistence,
} from "./external-issue-coordination";

const actor: ActorAccess = {
  principalId: "maintainer_1",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace_1"],
  projectIds: ["project_1"],
};

function setup() {
  const persistence: ExternalIssuePersistence = {
    grantConsent: vi.fn().mockResolvedValue({ version: 1, state: "active" }),
    revokeConsent: vi.fn().mockResolvedValue({ version: 2, state: "revoked" }),
    requestLink: vi.fn().mockResolvedValue({
      status: "accepted",
      linkId: "link_1",
      synchronizationState: "pending",
    }),
  };
  const dependencies: ExternalIssueCoordinatorDependencies = {
    principalVerifier: {
      verify: vi.fn().mockResolvedValue({
        status: "verified",
        principalId: "maintainer_1",
      }),
    },
    scopeResolver: {
      resolve: vi.fn().mockResolvedValue({ status: "authorized", actor }),
    },
    reporterProofVerifier: {
      verify: vi.fn().mockResolvedValue({
        status: "verified",
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    },
    persistence,
    digest: (value) => `digest:${JSON.stringify(value)}`,
    feedbackUrl: ({ workspaceId, projectId, reference }) =>
      `https://y7.example.test/w/${workspaceId}/p/${projectId}/f/${reference}`,
    now: () => "2026-08-28T13:00:00.000Z",
  };
  return { coordinator: createExternalIssueCoordinator(dependencies), dependencies };
}

describe("External issue coordinator", () => {
  it("BDD-ISSUE-HTTP-001 authenticates, derives scope, and requests one durable link", async () => {
    const { coordinator, dependencies } = setup();

    await expect(
      coordinator.requestLink({
        jwt: "jwt",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
          reference: "Y7-ABC123",
          consentVersion: 1,
        },
      }),
    ).resolves.toEqual({
      status: "ok",
      result: {
        status: "accepted",
        linkId: "link_1",
        synchronizationState: "pending",
      },
    });
    expect(dependencies.persistence.requestLink).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        protectedWorkspaceUrl:
          "https://y7.example.test/w/workspace_1/p/project_1/f/Y7-ABC123",
        occurredAt: "2026-08-28T13:00:00.000Z",
      }),
    );
  });

  it.each(["denied", "retryable"] as const)(
    "BDD-ISSUE-HTTP-002 maps principal %s without touching persistence",
    async (status) => {
      const { coordinator, dependencies } = setup();
      vi.mocked(dependencies.principalVerifier.verify).mockResolvedValue({ status });

      await expect(
        coordinator.requestLink({
          jwt: "jwt",
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
          command: {
            operationId: "operation_1",
            connectionId: "connection_1",
            repositoryId: "repository_1",
            reference: "Y7-ABC123",
          },
        }),
      ).resolves.toEqual({ status });
      expect(dependencies.persistence.requestLink).not.toHaveBeenCalled();
    },
  );

  it("BDD-ISSUE-HTTP-003 denies a mismatched resolved principal", async () => {
    const { coordinator, dependencies } = setup();
    vi.mocked(dependencies.scopeResolver.resolve).mockResolvedValue({
      status: "authorized",
      actor: { ...actor, principalId: "other" },
    });

    await expect(
      coordinator.requestLink({
        jwt: "jwt",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
          reference: "Y7-ABC123",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-ISSUE-HTTP-004 grants and revokes exact Feedback-specific consent", async () => {
    const { coordinator, dependencies } = setup();

    await expect(
      coordinator.grantConsent({
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "proof",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      }),
    ).resolves.toEqual({ status: "ok", consent: { version: 1, state: "active" } });
    await expect(
      coordinator.revokeConsent({
        operationId: "consent_revoke_1",
        reference: "Y7-ABC123",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "ok", consent: { version: 2, state: "revoked" } });
    expect(dependencies.persistence.grantConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "consent_grant_1",
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        audience: "github:repository_1",
      }),
    );
  });

  it("BDD-ISSUE-HTTP-005 returns non-disclosing denial for invalid proof or command", async () => {
    const { coordinator, dependencies } = setup();
    vi.mocked(dependencies.reporterProofVerifier.verify).mockResolvedValue({
      status: "denied",
    });

    await expect(
      coordinator.grantConsent({
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "bad",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.requestLink({
        jwt: "jwt",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: {
          operationId: "bad id",
          connectionId: "connection_1",
          repositoryId: "repository_1",
          reference: "Y7-ABC123",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-ISSUE-HTTP-005A rejects every malformed link boundary value", async () => {
    const { coordinator } = setup();
    const valid = {
      jwt: "jwt",
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      command: {
        operationId: "operation_1",
        connectionId: "connection_1",
        repositoryId: "repository_1",
        reference: "Y7-ABC123",
      },
    } as const;
    const invalid = [
      { ...valid, jwt: "" },
      { ...valid, jwt: "x".repeat(4_097) },
      { ...valid, workspaceId: "bad id" },
      { ...valid, projectId: "bad id" },
      { ...valid, feedbackId: "bad id" },
      { ...valid, command: { ...valid.command, operationId: "bad id" } },
      { ...valid, command: { ...valid.command, connectionId: "bad id" } },
      { ...valid, command: { ...valid.command, repositoryId: "bad id" } },
      { ...valid, command: { ...valid.command, reference: "bad ref!" } },
      { ...valid, command: { ...valid.command, consentVersion: 0 } },
      { ...valid, command: { ...valid.command, consentVersion: 1.5 } },
    ];

    for (const candidate of invalid) {
      await expect(coordinator.requestLink(candidate)).resolves.toEqual({
        status: "denied",
      });
    }
  });

  it("BDD-ISSUE-HTTP-005B validates consent disclosure and proof boundaries", async () => {
    const { coordinator } = setup();
    for (const candidate of [
      {
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "proof",
        disclosureVersion: "bad disclosure!",
        audience: "github:repository_1",
      },
      {
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "proof",
        disclosureVersion: "public-issue-v1",
        audience: "bitbucket:repository_1",
      },
      {
        operationId: "consent_grant_1",
        reference: "bad reference!",
        proof: "proof",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      },
      {
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      },
      {
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "x".repeat(513),
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      },
    ]) {
      await expect(coordinator.grantConsent(candidate)).resolves.toEqual({
        status: "denied",
      });
    }
  });

  it("BDD-ISSUE-HTTP-006 maps persistence conflicts and failures without disclosure", async () => {
    const { coordinator, dependencies } = setup();
    vi.mocked(dependencies.persistence.requestLink)
      .mockRejectedValueOnce(new Error("ERR-ISSUE-CONFLICT"))
      .mockRejectedValueOnce(new Error("database detail"));
    const input = {
      jwt: "jwt",
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      command: {
        operationId: "operation_1",
        connectionId: "connection_1",
        repositoryId: "repository_1",
        reference: "Y7-ABC123",
      },
    } as const;

    await expect(coordinator.requestLink(input)).resolves.toEqual({
      status: "conflict",
    });
    await expect(coordinator.requestLink(input)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-ISSUE-HTTP-007 maps consent persistence errors to stable outcomes", async () => {
    const { coordinator, dependencies } = setup();
    vi.mocked(dependencies.persistence.grantConsent).mockRejectedValue(
      new Error("ERR-ISSUE-DENIED"),
    );
    vi.mocked(dependencies.persistence.revokeConsent).mockRejectedValue(
      new Error("unavailable"),
    );

    await expect(
      coordinator.grantConsent({
        operationId: "consent_grant_1",
        reference: "Y7-ABC123",
        proof: "proof",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.revokeConsent({
        operationId: "consent_revoke_1",
        reference: "Y7-ABC123",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("BDD-ISSUE-HTTP-007A fails closed for revoked proof and non-Error failures", async () => {
    const { coordinator, dependencies } = setup();
    vi.mocked(dependencies.reporterProofVerifier.verify).mockResolvedValueOnce({
      status: "retryable",
    });
    await expect(
      coordinator.revokeConsent({
        operationId: "consent_revoke_1",
        reference: "Y7-ABC123",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      coordinator.revokeConsent({
        operationId: "bad id",
        reference: "Y7-ABC123",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "denied" });

    vi.mocked(dependencies.persistence.requestLink).mockRejectedValueOnce(
      "non-error failure",
    );
    await expect(
      coordinator.requestLink({
        jwt: "jwt",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: {
          operationId: "operation_1",
          connectionId: "connection_1",
          repositoryId: "repository_1",
          reference: "Y7-ABC123",
        },
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it.each(["denied", "retryable"] as const)(
    "BDD-ISSUE-HTTP-008 maps scope resolution %s",
    async (status) => {
      const { coordinator, dependencies } = setup();
      vi.mocked(dependencies.scopeResolver.resolve).mockResolvedValue({ status });

      await expect(
        coordinator.requestLink({
          jwt: "jwt",
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
          command: {
            operationId: "operation_1",
            connectionId: "connection_1",
            repositoryId: "repository_1",
            reference: "Y7-ABC123",
          },
        }),
      ).resolves.toEqual({ status });
    },
  );
});
