import { describe, expect, it, vi } from "vitest";

import { createHttpAdministrationGateway } from "./AdministrationGateway";

const command = {
  kind: "rename_project",
  operationId: "operation_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  slug: "new-slug",
};

describe("HTTP administration gateway", () => {
  it("sends a scoped command with a short-lived Appwrite JWT", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ status: "ok", project: { projectId: "project_1" } }),
          { status: 200 },
        ),
      ),
    );
    const gateway = createHttpAdministrationGateway(
      "https://api.example/",
      () => Promise.resolve("jwt"),
      fetcher,
    );
    await expect(gateway.execute(command)).resolves.toEqual({
      status: "ok",
      project: { projectId: "project_1" },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example/v1/workspaces/workspace_1/projects/project_1/commands",
    );
    expect(fetcher.mock.calls[0]?.[1].method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1].headers).toEqual({
      authorization: "Bearer jwt",
      "content-type": "application/json",
    });
  });

  it("uses the creation route and maps every stable failure", async () => {
    const errors = [
      ["ERR-ADMIN-COMMAND-INVALID", "invalid"],
      ["ERR-ADMIN-DENIED", "denied"],
      ["ERR-ADMIN-IDEMPOTENCY-CONFLICT", "conflict"],
      ["ERR-ADMIN-SLUG-RESERVED", "slug_reserved"],
      ["ERR-ADMIN-RETRYABLE", "retryable"],
    ] as const;
    for (const [error, status] of errors) {
      const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
        () => Promise.resolve(new Response(JSON.stringify({ error }), { status: 400 })),
      );
      const gateway = createHttpAdministrationGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        fetcher,
      );
      await expect(
        gateway.execute({ ...command, kind: "create_project" }),
      ).resolves.toEqual({ status });
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        "https://api.example/v1/workspaces/workspace_1/projects",
      );
    }
  });

  it("fails closed before transport without scope or JWT", async () => {
    const fetcher = vi.fn();
    const missing = createHttpAdministrationGateway(
      "https://api.example",
      () => Promise.resolve("jwt"),
      fetcher,
    );
    await expect(missing.execute({})).resolves.toEqual({ status: "invalid" });
    const denied = createHttpAdministrationGateway(
      "https://api.example",
      () => Promise.reject(new Error("no session")),
      fetcher,
    );
    await expect(denied.execute(command)).resolves.toEqual({ status: "denied" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("redacts malformed and network failures as retryable", async () => {
    for (const fetcher of [
      vi.fn(() => Promise.reject(new Error("secret SDK detail"))),
      vi.fn(() => Promise.resolve(new Response("{}", { status: 500 }))),
    ]) {
      const gateway = createHttpAdministrationGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        fetcher,
      );
      await expect(gateway.execute(command)).resolves.toEqual({
        status: "retryable",
      });
    }
  });
});
