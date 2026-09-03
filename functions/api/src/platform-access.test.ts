import { describe, expect, it, vi } from "vitest";

import { createPlatformAccessCoordinator } from "./platform-access";

const request = {
  kind: "request",
  grantId: "grant_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  feedbackId: "feedback_1",
  actions: ["feedback.read"],
  reasonCode: "SUPPORT_INCIDENT",
  justification: "Investigate the declared incident.",
  incidentSeverity: "ordinary",
  breakGlass: false,
};

function setup() {
  const verify = vi.fn(() =>
    Promise.resolve({ status: "verified" as const, principalId: "operator_1" }),
  );
  const authorize = vi.fn(() =>
    Promise.resolve({ status: "authorized" as const, freshMfa: true }),
  );
  const execute = vi.fn(() =>
    Promise.resolve({
      status: "applied" as const,
      grantId: "grant_1",
      state: "requested",
      revision: 0,
    }),
  );
  return {
    verify,
    authorize,
    execute,
    coordinator: createPlatformAccessCoordinator(
      { verify },
      { authorize },
      { execute },
    ),
  };
}

describe("trusted Platform exceptional access coordination", () => {
  it("BDD-PLAT-110 derives operator authority before creating a request", async () => {
    const target = setup();
    await expect(
      target.coordinator.execute({ jwt: "jwt_1", command: request }),
    ).resolves.toEqual({
      status: "ok",
      result: {
        disposition: "applied",
        grantId: "grant_1",
        state: "requested",
        revision: 0,
      },
    });
    expect(target.verify).toHaveBeenCalledWith("jwt_1");
    expect(target.authorize).toHaveBeenCalledWith({
      principalId: "operator_1",
      role: "platform_operator",
    });
    expect(target.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "operator_1",
        freshMfa: true,
        command: expect.objectContaining({ kind: "request" }),
      }),
    );
  });

  it("BDD-PLAT-111 requires owner authority and server-derived fresh MFA", async () => {
    const target = setup();
    await target.coordinator.execute({
      jwt: "jwt_1",
      command: {
        kind: "approve",
        grantId: "grant_1",
        expectedRevision: 0,
        expiresAt: "2026-09-03T13:00:00.000Z",
        freshMfa: true,
      },
    });
    expect(target.authorize).toHaveBeenCalledWith({
      principalId: "operator_1",
      role: "platform_owner",
    });
    expect(target.execute).toHaveBeenCalledWith(
      expect.objectContaining({ freshMfa: true }),
    );
    expect(target.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.not.objectContaining({ freshMfa: expect.anything() }),
      }),
    );
  });

  it("BDD-PLAT-112 denies before grant access when identity or role is absent", async () => {
    const unverified = setup();
    unverified.verify.mockResolvedValueOnce({ status: "denied" } as never);
    await expect(
      unverified.coordinator.execute({ jwt: "jwt_1", command: request }),
    ).resolves.toEqual({ status: "denied" });
    expect(unverified.authorize).not.toHaveBeenCalled();
    expect(unverified.execute).not.toHaveBeenCalled();

    const unauthorized = setup();
    unauthorized.authorize.mockResolvedValueOnce({ status: "denied" } as never);
    await expect(
      unauthorized.coordinator.execute({ jwt: "jwt_1", command: request }),
    ).resolves.toEqual({ status: "denied" });
    expect(unauthorized.execute).not.toHaveBeenCalled();
  });

  it("BDD-PLAT-113 parses every lifecycle command and rejects client ambiguity", async () => {
    const valid = [
      request,
      { ...request, projectId: undefined, feedbackId: undefined },
      {
        kind: "approve",
        grantId: "grant_1",
        expectedRevision: 0,
        expiresAt: "2026-09-03T13:00:00.000Z",
      },
      { kind: "deny", grantId: "grant_1", expectedRevision: 0 },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        action: "feedback.read",
      },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        action: "attachment.read",
      },
      { kind: "revoke", grantId: "grant_1", expectedRevision: 1 },
      { kind: "review", grantId: "grant_1", expectedRevision: 2 },
    ];
    for (const command of valid) {
      const target = setup();
      await expect(
        target.coordinator.execute({ jwt: "jwt_1", command }),
      ).resolves.toMatchObject({ status: "ok" });
    }
    for (const command of [
      null,
      { ...request, grantId: "bad id" },
      { ...request, workspaceId: 1 },
      { ...request, workspaceId: "bad id" },
      { ...request, projectId: "bad id" },
      { ...request, feedbackId: "bad id" },
      { ...request, actions: [] },
      { ...request, actions: ["unknown"] },
      { ...request, actions: ["feedback.read", "feedback.read"] },
      { ...request, reasonCode: "bad" },
      { ...request, justification: 1 },
      { ...request, incidentSeverity: "urgent" },
      { ...request, breakGlass: "yes" },
      { ...request, feedbackId: "feedback_1", projectId: undefined },
      { kind: "approve", grantId: "grant_1", expectedRevision: -1 },
      { kind: "approve", grantId: "grant_1", expectedRevision: 0, expiresAt: 1 },
      { kind: "use", grantId: "grant_1", expectedRevision: 1 },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "bad id",
        action: "feedback.read",
      },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        projectId: "bad id",
        action: "feedback.read",
      },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        feedbackId: "feedback_1",
        action: "feedback.read",
      },
      {
        kind: "use",
        grantId: "grant_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        action: "unknown",
      },
      { kind: "unknown", grantId: "grant_1", expectedRevision: 1 },
    ]) {
      const target = setup();
      await expect(
        target.coordinator.execute({ jwt: "jwt_1", command }),
      ).resolves.toEqual({ status: "invalid" });
      expect(target.verify).not.toHaveBeenCalled();
    }
  });

  it("BDD-PLAT-114 fails closed on authority/store outage and preserves outcomes", async () => {
    for (const status of ["retryable", "invalid", "conflict", "denied"] as const) {
      const target = setup();
      target.execute.mockResolvedValueOnce({ status } as never);
      await expect(
        target.coordinator.execute({ jwt: "jwt_1", command: request }),
      ).resolves.toEqual({ status });
    }
    const failed = setup();
    failed.authorize.mockRejectedValueOnce(new Error("authority unavailable"));
    await expect(
      failed.coordinator.execute({ jwt: "jwt_1", command: request }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
