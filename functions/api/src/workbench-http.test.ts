import { describe, expect, it, vi } from "vitest";

import { createWorkbenchHttp } from "./workbench-http";

const path = "/v1/workspaces/workspace_1/projects/project_1/workbench";

describe("Workbench HTTP", () => {
  it("BDD-WORK-009 parses bounded inbox filters", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", result: [] });
    const http = createWorkbenchHttp({ list, read: vi.fn() });

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
});
