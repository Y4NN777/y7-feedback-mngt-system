import { describe, expect, it, vi } from "vitest";

import type { ProjectAdministration } from "./project-administration";
import { createProjectAdministrationHttp } from "./project-administration-http";

function setup() {
  const execute = vi.fn<ProjectAdministration["execute"]>(() =>
    Promise.resolve({
      status: "ok",
      result: { projectId: "project_1", slug: "wise-money" },
    }),
  );
  return { execute, http: createProjectAdministrationHttp({ execute }) };
}

const body = {
  kind: "create_project",
  operationId: "operation_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  slug: "wise-money",
  enabledTypes: ["bug"],
  contextDeclarations: [],
  reporterPurpose: { fr: "But français", en: "English purpose" },
};

describe("Project administration HTTP contract", () => {
  it("BDD-ADMIN-001 exposes the trusted Owner Project creation route", async () => {
    const target = setup();
    await expect(
      target.http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects",
        headers: { authorization: "Bearer valid-jwt" },
        body,
      }),
    ).resolves.toEqual({
      statusCode: 201,
      body: {
        status: "ok",
        project: { projectId: "project_1", slug: "wise-money" },
      },
    });
    expect(target.execute).toHaveBeenCalledWith({
      jwt: "valid-jwt",
      command: body,
    });
  });

  it("BDD-ADMIN-003..008 exposes scoped Project command routes", async () => {
    const target = setup();
    const rename = {
      kind: "rename_project",
      operationId: "operation_2",
      workspaceId: "workspace_1",
      projectId: "project_1",
      slug: "new-slug",
    };
    target.execute.mockResolvedValueOnce({
      status: "ok",
      result: {
        projectId: "project_1",
        action: "rename_project",
        slug: "new-slug",
      },
    });
    await expect(
      target.http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects/project_1/commands",
        headers: { authorization: "Bearer valid-jwt" },
        body: rename,
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        project: {
          projectId: "project_1",
          action: "rename_project",
          slug: "new-slug",
        },
      },
    });
    expect(target.execute).toHaveBeenCalledWith({
      jwt: "valid-jwt",
      command: rename,
    });
  });

  it("does not claim unrelated methods or paths", async () => {
    const target = setup();
    for (const request of [
      { method: "GET", path: "/v1/workspaces/workspace_1/projects" },
      { method: "POST", path: "/v1/projects" },
    ]) {
      await expect(
        target.http.handle({ ...request, headers: {}, body }),
      ).resolves.toBeUndefined();
    }
    expect(target.execute).not.toHaveBeenCalled();
  });

  it("BDD-ADMIN-002 rejects missing authority and path/body scope mismatch without invoking the use case", async () => {
    for (const request of [
      {
        headers: {},
        body,
      },
      {
        headers: { authorization: "Basic credential" },
        body,
      },
      {
        headers: { authorization: "Bearer " },
        body,
      },
      {
        headers: { authorization: `Bearer ${"x".repeat(4097)}` },
        body,
      },
      {
        headers: { authorization: "Bearer valid-jwt" },
        body: { ...body, workspaceId: "workspace_2" },
      },
      {
        headers: { authorization: "Bearer valid-jwt" },
        body: { ...body, kind: "rename_project", projectId: "project_2" },
        path: "/v1/workspaces/workspace_1/projects/project_1/commands",
      },
    ]) {
      const target = setup();
      await expect(
        target.http.handle({
          method: "POST",
          path: "/v1/workspaces/workspace_1/projects",
          ...request,
        }),
      ).resolves.toEqual({
        statusCode: 403,
        body: { error: "ERR-ADMIN-DENIED" },
      });
      expect(target.execute).not.toHaveBeenCalled();
    }
  });

  it("maps every use-case outcome to a stable transport contract", async () => {
    for (const [outcome, expected] of [
      [{ status: "invalid" }, [400, "ERR-ADMIN-COMMAND-INVALID"]],
      [{ status: "denied" }, [403, "ERR-ADMIN-DENIED"]],
      [{ status: "conflict" }, [409, "ERR-ADMIN-IDEMPOTENCY-CONFLICT"]],
      [{ status: "slug_reserved" }, [409, "ERR-ADMIN-SLUG-RESERVED"]],
      [{ status: "retryable" }, [503, "ERR-ADMIN-RETRYABLE"]],
    ] as const) {
      const target = setup();
      target.execute.mockResolvedValueOnce(outcome);
      const response = await target.http.handle({
        method: "POST",
        path: "/v1/workspaces/workspace_1/projects",
        headers: { authorization: "Bearer valid-jwt" },
        body,
      });
      expect(response).toEqual({
        statusCode: expected[0],
        body: { error: expected[1] },
      });
    }
  });
});
