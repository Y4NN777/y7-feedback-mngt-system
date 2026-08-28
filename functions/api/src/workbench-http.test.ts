import { describe, expect, it, vi } from "vitest";

import { createWorkbenchHttp } from "./workbench-http";
import type { WorkbenchCoordinator } from "./workbench";

const path = "/v1/workspaces/workspace_1/projects/project_1/workbench";

describe("Workbench HTTP", () => {
  it("BDD-WORK-009 parses bounded inbox filters", async () => {
    const list = vi
      .fn<WorkbenchCoordinator["list"]>()
      .mockResolvedValue({ status: "ok", result: [] });
    const http = createWorkbenchHttp({ list, read: vi.fn(), execute: vi.fn() });

    await expect(
      http.handle({
        method: "GET",
        path,
        headers: { authorization: "Bearer jwt_1" },
        query: {
          type: "bug,suggestion",
          state: "received",
          assignment: "assigned_to_me",
        },
      }),
    ).resolves.toEqual({ statusCode: 200, body: { status: "ok", result: [] } });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          types: ["bug", "suggestion"],
          states: ["received"],
          assignment: "assigned_to_me",
        },
      }),
    );
  });

  it("BDD-WORK-010 rejects forged headers and invalid filters", async () => {
    const http = createWorkbenchHttp({
      list: vi.fn().mockResolvedValue({ status: "ok", result: [] }),
      read: vi.fn(),
      execute: vi.fn(),
    });
    await expect(
      http.handle({
        method: "GET",
        path,
        headers: { authorization: "Bearer jwt_1", "x-appwrite-user-id": "owner_1" },
        query: {},
      }),
    ).resolves.toMatchObject({ statusCode: 404 });
    await expect(
      http.handle({
        method: "GET",
        path,
        headers: { authorization: "Bearer jwt_1" },
        query: { state: "invented" },
      }),
    ).resolves.toEqual({
      statusCode: 400,
      body: { error: "ERR-WORK-FILTER-INVALID" },
    });
  });

  it("BDD-WORK-015 maps mutation conflicts without disclosing state", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "conflict" });
    const http = createWorkbenchHttp({ list: vi.fn(), read: vi.fn(), execute });
    await expect(
      http.handle({
        method: "POST",
        path: `${path}/feedback_1`,
        headers: { authorization: "Bearer jwt_1" },
        query: {},
        body: { kind: "delete_feedback", operationId: "operation_1" },
      }),
    ).resolves.toEqual({ statusCode: 409, body: { error: "ERR-WORK-CONFLICT" } });
  });

  it("routes detail reads and maps all stable outcomes", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: "ok", result: { feedbackId: "feedback_1" } })
      .mockResolvedValueOnce({ status: "denied" })
      .mockResolvedValueOnce({ status: "invalid" })
      .mockResolvedValueOnce({ status: "retryable" });
    const http = createWorkbenchHttp({ list: vi.fn(), read, execute: vi.fn() });
    const request = {
      method: "GET",
      path: `${path}/feedback_1`,
      headers: { Authorization: "Bearer jwt_1" },
      query: {},
    };
    await expect(http.handle(request)).resolves.toMatchObject({ statusCode: 200 });
    await expect(http.handle(request)).resolves.toMatchObject({ statusCode: 404 });
    await expect(http.handle(request)).resolves.toMatchObject({ statusCode: 400 });
    await expect(http.handle(request)).resolves.toMatchObject({ statusCode: 503 });
    await expect(http.handle({ ...request, method: "PUT" })).resolves.toBeUndefined();
  });

  it("parses time bounds and rejects missing or malformed bearer credentials", async () => {
    const list = vi
      .fn<WorkbenchCoordinator["list"]>()
      .mockResolvedValue({ status: "ok", result: [] });
    const http = createWorkbenchHttp({ list, read: vi.fn(), execute: vi.fn() });
    await http.handle({
      method: "GET",
      path,
      headers: { AUTHORIZATION: "Bearer jwt_1" },
      query: {
        type: "",
        acceptedFrom: "2026-08-01T00:00:00.000Z",
        acceptedTo: "2026-08-31T23:59:59.000Z",
      },
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0].filter).toEqual({
      types: [],
      states: [],
      assignment: "all",
      acceptedFrom: "2026-08-01T00:00:00.000Z",
      acceptedTo: "2026-08-31T23:59:59.000Z",
    });
    await expect(
      http.handle({ method: "GET", path, headers: {}, query: {} }),
    ).resolves.toMatchObject({ statusCode: 404 });
    await expect(
      http.handle({
        method: "GET",
        path,
        headers: { authorization: "Basic no" },
        query: {},
      }),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});
