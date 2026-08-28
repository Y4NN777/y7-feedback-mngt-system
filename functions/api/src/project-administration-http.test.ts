import { describe, expect, it, vi } from "vitest";

import type { ProjectAdministration } from "./project-administration";
import { createProjectAdministrationHttp } from "./project-administration-http";

function setup() {
  const create = vi.fn<ProjectAdministration["create"]>(() =>
    Promise.resolve({
      status: "ok",
      result: { projectId: "project_1", slug: "wise-money" },
    }),
  );
  return { create, http: createProjectAdministrationHttp({ create }) };
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
    expect(target.create).toHaveBeenCalledWith({
      jwt: "valid-jwt",
      command: body,
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
    expect(target.create).not.toHaveBeenCalled();
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
      expect(target.create).not.toHaveBeenCalled();
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
      target.create.mockResolvedValueOnce(outcome);
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
