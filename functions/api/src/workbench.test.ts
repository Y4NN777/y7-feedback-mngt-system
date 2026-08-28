import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import type { WorkbenchStore } from "./appwrite-workbench-store";
import { AppwriteWorkbenchError } from "./appwrite-workbench-store";
import { createWorkbenchCoordinator } from "./workbench";

const actor: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

describe("Workbench coordinator", () => {
  it("BDD-WORK-007 verifies identity and authoritative scope before listing", async () => {
    const list = vi.fn<WorkbenchStore["list"]>().mockResolvedValue([]);
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      {
        resolve: vi.fn().mockResolvedValue({
          status: "authorized",
          actor,
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      },
      { list, read: vi.fn() },
      { execute: vi.fn() },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );

    await expect(
      coordinator.list({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "ok", result: [] });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ actor }));
  });

  it("BDD-WORK-008 returns no data when verification is denied", async () => {
    const list = vi.fn<WorkbenchStore["list"]>();
    const coordinator = createWorkbenchCoordinator(
      { verify: vi.fn().mockResolvedValue({ status: "denied" }) },
      { resolve: vi.fn() },
      { list, read: vi.fn() },
      { execute: vi.fn() },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );

    await expect(
      coordinator.list({
        jwt: "forged",
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(list).not.toHaveBeenCalled();
  });

  it("BDD-WORK-016 derives the actor and commits a trusted mutation", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "applied",
      feedbackId: "feedback_1",
      action: "classify_feedback",
    });
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      {
        resolve: vi.fn().mockResolvedValue({
          status: "authorized",
          actor,
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      },
      { list: vi.fn(), read: vi.fn() },
      { execute },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );
    await expect(
      coordinator.execute({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: {
          kind: "classify_feedback",
          operationId: "operation_1",
          classification: "Performance",
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ actor, feedbackId: "feedback_1" }),
    );
  });

  it("covers reads, parser variants, scope denial and stable failures", async () => {
    const store: WorkbenchStore = {
      list: vi.fn().mockRejectedValue(new Error("transport")),
      read: vi.fn().mockResolvedValue({ feedbackId: "feedback_1" }),
    };
    const execute = vi.fn().mockResolvedValue({
      status: "applied",
      feedbackId: "feedback_1",
      action: "delete_feedback",
    });
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      {
        resolve: vi.fn().mockResolvedValue({
          status: "authorized",
          actor,
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      },
      store,
      { execute },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );
    const scoped = { jwt: "jwt_1", workspaceId: "workspace_1", projectId: "project_1" };
    await expect(
      coordinator.list({
        ...scoped,
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      coordinator.read({ ...scoped, feedbackId: "feedback_1" }),
    ).resolves.toMatchObject({ status: "ok" });
    for (const command of [
      {
        kind: "assign_feedback",
        operationId: "operation_2",
        maintainerId: "maintainer_1",
      },
      { kind: "unassign_feedback", operationId: "operation_3" },
      { kind: "delete_feedback", operationId: "operation_4" },
    ])
      await expect(
        coordinator.execute({ ...scoped, feedbackId: "feedback_1", command }),
      ).resolves.toMatchObject({ status: "ok" });
    for (const command of [
      null,
      [],
      {},
      { kind: "classify_feedback", operationId: "x" },
      { kind: "assign_feedback", operationId: "x" },
      { kind: "invented", operationId: "x" },
    ])
      await expect(
        coordinator.execute({ ...scoped, feedbackId: "feedback_1", command }),
      ).resolves.toEqual({ status: "invalid" });

    execute.mockRejectedValueOnce(new AppwriteWorkbenchError("ERR-WORK-CONFLICT"));
    await expect(
      coordinator.execute({
        ...scoped,
        feedbackId: "feedback_1",
        command: { kind: "delete_feedback", operationId: "operation_5" },
      }),
    ).resolves.toEqual({ status: "conflict" });
    execute.mockRejectedValueOnce(new AppwriteWorkbenchError("ERR-WORK-DENIED"));
    await expect(
      coordinator.execute({
        ...scoped,
        feedbackId: "feedback_1",
        command: { kind: "delete_feedback", operationId: "operation_6" },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("does not call a store when authoritative scope denies the request", async () => {
    const read = vi.fn();
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      { resolve: vi.fn().mockResolvedValue({ status: "denied" }) },
      { list: vi.fn(), read },
      { execute: vi.fn() },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );
    await expect(
      coordinator.read({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(read).not.toHaveBeenCalled();
    await expect(
      coordinator.execute({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
        command: { kind: "delete_feedback", operationId: "operation_denied" },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("maps detail-store failures to stable non-disclosing outcomes", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new AppwriteWorkbenchError("ERR-WORK-DENIED"))
      .mockRejectedValueOnce(new Error("transport"));
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      {
        resolve: vi.fn().mockResolvedValue({
          status: "authorized",
          actor,
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      },
      { list: vi.fn(), read },
      { execute: vi.fn() },
      { digest: () => "digest_1234567890", now: () => "2026-08-28T10:00:00.000Z" },
    );
    const input = {
      jwt: "jwt_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
    };
    await expect(coordinator.read(input)).resolves.toEqual({ status: "denied" });
    await expect(coordinator.read(input)).resolves.toEqual({ status: "retryable" });
    read.mockRejectedValueOnce(new AppwriteWorkbenchError("ERR-WORK-RETRYABLE"));
    await expect(coordinator.read(input)).resolves.toEqual({ status: "retryable" });
  });
});
