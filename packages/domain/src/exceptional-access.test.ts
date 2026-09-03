import { describe, expect, it } from "vitest";

import {
  approveExceptionalAccess,
  denyExceptionalAccess,
  expireExceptionalAccess,
  requestExceptionalAccess,
  reviewBreakGlass,
  revokeExceptionalAccess,
  useExceptionalAccess,
  type ExceptionalAccessGrant,
} from "./exceptional-access";

const now = "2026-09-03T12:00:00.000Z";
const scope = {
  workspaceId: "workspace_1",
  projectId: "project_1",
  feedbackId: "feedback_1",
  actions: ["feedback.read", "attachment.read"] as const,
};

function requested(overrides: Record<string, unknown> = {}): ExceptionalAccessGrant {
  const result = requestExceptionalAccess({
    id: "grant_1",
    requesterId: "operator_1",
    scope,
    reasonCode: "SUPPORT_INCIDENT",
    justification: "Investigate the declared customer incident.",
    incidentSeverity: "ordinary",
    breakGlass: false,
    now,
    ...overrides,
  });
  if (result.status !== "ok") throw new Error("fixture invalid");
  return result.grant;
}

function active(overrides: Record<string, unknown> = {}): ExceptionalAccessGrant {
  const grant = requested(overrides);
  const result = approveExceptionalAccess(grant, {
    approverId: "owner_1",
    freshMfa: true,
    expectedRevision: 0,
    now: "2026-09-03T12:01:00.000Z",
    expiresAt: "2026-09-03T13:01:00.000Z",
  });
  if (result.status !== "ok") throw new Error("fixture invalid");
  return result.grant;
}

describe("exceptional access policy", () => {
  it("BDD-PLAT-001 requests a purpose-bound minimum scope", () => {
    const result = requestExceptionalAccess({
      id: "grant_1",
      requesterId: "operator_1",
      scope,
      reasonCode: "SUPPORT_INCIDENT",
      justification: "Investigate the declared customer incident.",
      incidentSeverity: "ordinary",
      breakGlass: false,
      now,
    });
    expect(result).toMatchObject({
      status: "ok",
      grant: { state: "requested", revision: 0, useCount: 0 },
      audit: { type: "requested", sequence: 1, actorId: "operator_1" },
    });
  });

  it("BDD-PLAT-002 requires a distinct owner, fresh MFA and at most one hour", () => {
    const grant = requested();
    expect(
      approveExceptionalAccess(grant, {
        approverId: "operator_1",
        freshMfa: true,
        expectedRevision: 0,
        now,
        expiresAt: "2026-09-03T12:30:00.000Z",
      }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_SELF_APPROVAL" });
    expect(
      approveExceptionalAccess(grant, {
        approverId: "owner_1",
        freshMfa: false,
        expectedRevision: 0,
        now,
        expiresAt: "2026-09-03T12:30:00.000Z",
      }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_MFA_REQUIRED" });
    expect(
      approveExceptionalAccess(grant, {
        approverId: "owner_1",
        freshMfa: true,
        expectedRevision: 0,
        now,
        expiresAt: "2026-09-03T13:00:00.001Z",
      }),
    ).toMatchObject({ status: "invalid" });
    expect(active()).toMatchObject({
      state: "active",
      approverId: "owner_1",
      expiresAt: "2026-09-03T13:01:00.000Z",
    });
  });

  it("BDD-PLAT-003 checks operator, scope, action, expiry and revision on every use", () => {
    const grant = active();
    const valid = {
      operatorId: "operator_1",
      expectedRevision: 1,
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      action: "feedback.read" as const,
      now: "2026-09-03T12:02:00.000Z",
    };
    expect(useExceptionalAccess(grant, valid)).toMatchObject({
      status: "ok",
      grant: { useCount: 1, revision: 2 },
      audit: { type: "used" },
    });
    expect(
      useExceptionalAccess(grant, { ...valid, operatorId: "operator_2" }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_WRONG_OPERATOR" });
    expect(
      useExceptionalAccess(grant, { ...valid, workspaceId: "workspace_2" }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_SCOPE_DENIED" });
    expect(
      useExceptionalAccess(grant, { ...valid, action: "message.read" }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_SCOPE_DENIED" });
    expect(
      useExceptionalAccess(grant, { ...valid, now: grant.expiresAt! }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_EXPIRED" });
    expect(
      useExceptionalAccess(grant, { ...valid, expectedRevision: 9 }),
    ).toMatchObject({ status: "conflict" });
  });

  it("BDD-PLAT-004 rejects extensions and resolves concurrent revoke/use by revision", () => {
    const grant = active();
    expect(
      approveExceptionalAccess(grant, {
        approverId: "owner_2",
        freshMfa: true,
        expectedRevision: 1,
        now: "2026-09-03T12:10:00.000Z",
        expiresAt: "2026-09-03T13:10:00.000Z",
      }),
    ).toMatchObject({ status: "conflict" });
    const revoked = revokeExceptionalAccess(grant, {
      actorId: "owner_1",
      expectedRevision: 1,
      now: "2026-09-03T12:10:00.000Z",
    });
    expect(revoked).toMatchObject({ status: "ok", grant: { state: "revoked" } });
    if (revoked.status !== "ok") throw new Error("fixture invalid");
    expect(
      useExceptionalAccess(revoked.grant, {
        operatorId: "operator_1",
        expectedRevision: 1,
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        action: "feedback.read",
        now: "2026-09-03T12:11:00.000Z",
      }),
    ).toMatchObject({ status: "conflict" });
  });

  it("BDD-PLAT-005 allows critical break-glass only and requires independent review", () => {
    expect(() => requested({ breakGlass: true })).toThrow("fixture invalid");
    const grant = active({ breakGlass: true, incidentSeverity: "critical" });
    const used = useExceptionalAccess(grant, {
      operatorId: "operator_1",
      expectedRevision: 1,
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      action: "feedback.read",
      now: "2026-09-03T12:02:00.000Z",
    });
    if (used.status !== "ok") throw new Error("fixture invalid");
    const stopped = revokeExceptionalAccess(used.grant, {
      actorId: "owner_1",
      expectedRevision: 2,
      now: "2026-09-03T12:10:00.000Z",
    });
    expect(stopped).toMatchObject({
      status: "ok",
      grant: { state: "review_required" },
    });
    if (stopped.status !== "ok") throw new Error("fixture invalid");
    expect(
      reviewBreakGlass(stopped.grant, {
        reviewerId: "operator_1",
        expectedRevision: 3,
        now,
      }),
    ).toMatchObject({ status: "denied" });
    expect(
      reviewBreakGlass(stopped.grant, {
        reviewerId: "owner_2",
        expectedRevision: 3,
        now,
      }),
    ).toMatchObject({ status: "ok", grant: { state: "reviewed" } });
  });

  it("BDD-PLAT-008 expires grants durably and sends used break-glass to review", () => {
    const ordinary = active();
    expect(
      expireExceptionalAccess(ordinary, {
        actorId: "expiry_worker_1",
        expectedRevision: 1,
        now: ordinary.expiresAt!,
      }),
    ).toMatchObject({
      status: "ok",
      grant: {
        state: "expired",
        revision: 2,
        expiredAt: ordinary.expiresAt,
      },
      audit: { type: "expired", actorId: "expiry_worker_1", sequence: 2 },
    });

    const emergency = active({ breakGlass: true, incidentSeverity: "critical" });
    const used = useExceptionalAccess(emergency, {
      operatorId: "operator_1",
      expectedRevision: 1,
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      action: "feedback.read",
      now: "2026-09-03T12:02:00.000Z",
    });
    if (used.status !== "ok") throw new Error("fixture invalid");
    expect(
      expireExceptionalAccess(used.grant, {
        actorId: "expiry_worker_1",
        expectedRevision: 2,
        now: used.grant.expiresAt!,
      }),
    ).toMatchObject({
      status: "ok",
      grant: { state: "review_required", revision: 3 },
      audit: { type: "expired", sequence: 3 },
    });
  });

  it("BDD-PLAT-009 denies premature, malformed and concurrent expiry", () => {
    const grant = active();
    expect(
      expireExceptionalAccess(grant, {
        actorId: "expiry_worker_1",
        expectedRevision: 1,
        now: "2026-09-03T13:00:59.999Z",
      }),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_NOT_EXPIRED" });
    expect(
      expireExceptionalAccess(grant, {
        actorId: "expiry_worker_1",
        expectedRevision: 9,
        now: grant.expiresAt!,
      }),
    ).toMatchObject({ status: "conflict" });
    for (const candidate of [
      {
        value: grant,
        input: { actorId: "bad id", expectedRevision: 1, now: grant.expiresAt! },
      },
      {
        value: grant,
        input: { actorId: "expiry_worker_1", expectedRevision: 1, now: "invalid" },
      },
      {
        value: { ...grant, expiresAt: undefined } as ExceptionalAccessGrant,
        input: { actorId: "expiry_worker_1", expectedRevision: 1, now },
      },
      {
        value: { ...grant, state: "revoked" as const },
        input: { actorId: "expiry_worker_1", expectedRevision: 1, now },
      },
    ]) {
      expect(expireExceptionalAccess(candidate.value, candidate.input)).toMatchObject({
        status: "denied",
        code: "EXCEPTIONAL_ACCESS_EXPIRY_DENIED",
      });
    }
  });

  it("BDD-PLAT-006 supports independent denial and rejects malformed requests", () => {
    expect(
      denyExceptionalAccess(requested(), {
        approverId: "owner_1",
        expectedRevision: 0,
        now,
      }),
    ).toMatchObject({ status: "ok", grant: { state: "denied" } });
    for (const overrides of [
      { id: "bad id" },
      { requesterId: "" },
      { reasonCode: "bad" },
      { justification: "short" },
      { now: "invalid" },
      { scope: { ...scope, actions: [] } },
      {
        scope: {
          workspaceId: scope.workspaceId,
          feedbackId: "feedback_1",
          actions: scope.actions,
        },
      },
    ]) {
      expect(
        requestExceptionalAccess({
          id: "grant_1",
          requesterId: "operator_1",
          scope,
          reasonCode: "SUPPORT_INCIDENT",
          justification: "Investigate the declared customer incident.",
          incidentSeverity: "ordinary",
          breakGlass: false,
          now,
          ...overrides,
        }),
      ).toMatchObject({ status: "invalid" });
    }
  });

  it("BDD-PLAT-007 fails closed for malformed lifecycle commands", () => {
    const grant = requested();
    for (const input of [
      {
        approverId: "bad id",
        freshMfa: true,
        expectedRevision: 0,
        now,
        expiresAt: "2026-09-03T12:30:00.000Z",
      },
      {
        approverId: "owner_1",
        freshMfa: true,
        expectedRevision: 0,
        now: "invalid",
        expiresAt: "2026-09-03T12:30:00.000Z",
      },
      {
        approverId: "owner_1",
        freshMfa: true,
        expectedRevision: 0,
        now,
        expiresAt: "invalid",
      },
      {
        approverId: "owner_1",
        freshMfa: true,
        expectedRevision: 0,
        now,
        expiresAt: now,
      },
    ])
      expect(approveExceptionalAccess(grant, input)).toMatchObject({
        status: "invalid",
      });

    for (const input of [
      { approverId: "operator_1", expectedRevision: 0, now },
      { approverId: "bad id", expectedRevision: 0, now },
      { approverId: "owner_1", expectedRevision: 9, now },
      { approverId: "owner_1", expectedRevision: 0, now: "invalid" },
    ])
      expect(denyExceptionalAccess(grant, input)).toMatchObject({ status: "denied" });

    const live = active();
    const use = {
      operatorId: "operator_1",
      expectedRevision: 1,
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      action: "feedback.read" as const,
      now: "2026-09-03T12:02:00.000Z",
    };
    expect(
      useExceptionalAccess(live, { ...use, operatorId: "bad id" }),
    ).not.toHaveProperty("audit");
    expect(useExceptionalAccess(live, { ...use, now: "invalid" })).not.toHaveProperty(
      "audit",
    );
    expect(useExceptionalAccess({ ...live, state: "revoked" }, use)).toMatchObject({
      status: "denied",
      code: "EXCEPTIONAL_ACCESS_NOT_ACTIVE",
    });
    expect(
      useExceptionalAccess(
        { ...live, expiresAt: undefined } as unknown as ExceptionalAccessGrant,
        use,
      ),
    ).toMatchObject({ status: "denied", code: "EXCEPTIONAL_ACCESS_EXPIRED" });

    expect(
      revokeExceptionalAccess(live, { actorId: "owner_1", expectedRevision: 9, now }),
    ).toMatchObject({ status: "conflict" });
    expect(
      revokeExceptionalAccess(live, { actorId: "bad id", expectedRevision: 1, now }),
    ).toMatchObject({ status: "denied" });
    expect(
      revokeExceptionalAccess(
        { ...live, state: "revoked" },
        { actorId: "owner_1", expectedRevision: 1, now },
      ),
    ).toMatchObject({ status: "denied" });
    expect(
      revokeExceptionalAccess(live, {
        actorId: "owner_1",
        expectedRevision: 1,
        now: "invalid",
      }),
    ).toMatchObject({ status: "denied" });

    expect(
      reviewBreakGlass(live, { reviewerId: "owner_2", expectedRevision: 1, now }),
    ).toMatchObject({ status: "denied" });
    const review = { ...live, state: "review_required" as const };
    expect(
      reviewBreakGlass(review, { reviewerId: "owner_2", expectedRevision: 9, now }),
    ).toMatchObject({ status: "denied" });
    expect(
      reviewBreakGlass(review, { reviewerId: "bad id", expectedRevision: 1, now }),
    ).toMatchObject({ status: "denied" });
    expect(
      reviewBreakGlass(review, {
        reviewerId: "owner_2",
        expectedRevision: 1,
        now: "invalid",
      }),
    ).toMatchObject({ status: "denied" });
  });
});
