import { describe, expect, it, vi } from "vitest";

import { routeRequest, type FunctionContext } from "./http";
import type { PublicApi } from "./public-api";
import type { ProjectAdministrationHttp } from "./project-administration-http";

const correlationId = "018f4f7e-89ab-7def-8123-456789abcdef";
const dependencies = {
  createCorrelationId: () => correlationId,
  environment: "preview" as const,
  now: () => 104,
  release: "commit-123",
  startedAt: () => 100,
};

function createContext(
  method: string,
  path: string,
  request: Partial<FunctionContext["req"]> = {},
) {
  const json = vi.fn();
  const binary = vi.fn();
  const context: FunctionContext = {
    req: { method, path, ...request },
    res: { binary, json },
    log: vi.fn(),
    error: vi.fn(),
  };

  return { binary, context, json };
}

describe("trusted API entrypoint", () => {
  it("BDD-INGRESS-001 accepts exactly 10 MiB plus multipart overhead in Preview", async () => {
    const fileBytes = 10 * 1024 * 1024;
    const bodyBinary = new Uint8Array(fileBytes + 173);
    const { context, json } = createContext("post", "/operational/ingress-probe", {
      headers: {
        "content-type": "multipart/form-data; boundary=y7-feedback-ingress-probe",
        "x-y7-ingress-file-bytes": String(fileBytes),
        "x-y7-ingress-total-bytes": String(bodyBinary.byteLength),
      },
      bodyBinary,
    });

    await routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledWith(
      { accepted: true, fileBytes, totalBytes: bodyBinary.byteLength },
      200,
      expect.objectContaining({ "cache-control": "no-store" }),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('"operation":"ingress_probe"'),
    );
  });

  it("BDD-INGRESS-002 denies a mismatched body and hides the probe in Production", async () => {
    const fileBytes = 10 * 1024 * 1024;
    const request = {
      headers: {
        "content-type": "multipart/form-data; boundary=y7-feedback-ingress-probe",
        "x-y7-ingress-file-bytes": String(fileBytes),
        "x-y7-ingress-total-bytes": String(fileBytes + 173),
      },
      bodyBinary: new Uint8Array(8),
    } as const;
    const mismatch = createContext("POST", "/operational/ingress-probe", request);
    const missingHeaders = createContext("POST", "/operational/ingress-probe");
    const production = createContext("POST", "/operational/ingress-probe", request);

    await routeRequest(mismatch.context, dependencies);
    await routeRequest(missingHeaders.context, dependencies);
    await routeRequest(production.context, {
      ...dependencies,
      environment: "production",
    });

    expect(mismatch.json).toHaveBeenCalledWith(
      { error: "ERR-INGRESS-PROBE-INVALID" },
      400,
      expect.any(Object),
    );
    expect(missingHeaders.json).toHaveBeenCalledWith(
      { error: "ERR-INGRESS-PROBE-INVALID" },
      400,
      expect.any(Object),
    );
    expect(production.json).toHaveBeenCalledWith(
      { error: "not_found" },
      404,
      expect.any(Object),
    );
  });

  it("BDD-API-001 returns a non-cacheable health response", async () => {
    const { context, json } = createContext("GET", "/health");

    await routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith(
      { status: "ok" },
      200,
      expect.objectContaining({
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
      }),
    );
    expect(context.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "api.request.completed",
        correlationId,
        environment: "preview",
        release: "commit-123",
        operation: "health",
        outcome: "success",
        statusCode: 200,
        durationMs: 4,
      }),
    );
  });

  it("BDD-PROJ-HTTP-001 does not parse an absent JSON body for GET routing", async () => {
    const handle = vi.fn(() =>
      Promise.resolve({ statusCode: 200, body: { status: "current" } }),
    );
    const { context, json } = createContext("GET", "/v1/projects/wisemoney");
    Object.defineProperty(context.req, "bodyJson", {
      get() {
        throw new Error("GET body must not be parsed");
      },
    });

    await routeRequest(context, {
      ...dependencies,
      publicApi: { handle },
    });

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", body: undefined }),
    );
    expect(json).toHaveBeenCalledWith(
      { status: "current" },
      200,
      expect.objectContaining({ "access-control-allow-origin": "*" }),
    );
  });

  it("BDD-PROJ-HTTP-002 answers the public browser preflight without delegation", async () => {
    const handle = vi.fn<PublicApi["handle"]>();
    const { context, json } = createContext("OPTIONS", "/v1/projects/wisemoney");

    await routeRequest(context, {
      ...dependencies,
      publicApi: { handle },
    });

    expect(handle).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(null, 204, {
      "access-control-allow-headers": "authorization, content-type, x-appwrite-user-id",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-max-age": "600",
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    });
  });

  it("BDD-ADMIN-001 routes trusted administration before the public API", async () => {
    const handle = vi.fn<ProjectAdministrationHttp["handle"]>(() =>
      Promise.resolve({
        statusCode: 201,
        body: { status: "ok", project: { projectId: "project_1" } },
      }),
    );
    const publicHandle = vi.fn<PublicApi["handle"]>();
    const body = { workspaceId: "workspace_1" };
    const { context, json } = createContext(
      "POST",
      "/v1/workspaces/workspace_1/projects",
      {
        headers: {
          authorization: "Bearer valid-jwt",
          "content-type": "application/json",
        },
        bodyJson: body,
      },
    );

    await routeRequest(context, {
      ...dependencies,
      projectAdministration: { handle },
      publicApi: { handle: publicHandle },
    });

    expect(handle).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/workspaces/workspace_1/projects",
      headers: {
        authorization: "Bearer valid-jwt",
        "content-type": "application/json",
      },
      body,
    });
    expect(publicHandle).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      { status: "ok", project: { projectId: "project_1" } },
      201,
      expect.any(Object),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('"operation":"project_administration"'),
    );
  });

  it("does not parse multipart content as an administration JSON command", async () => {
    const handle = vi.fn<ProjectAdministrationHttp["handle"]>(() =>
      Promise.resolve(undefined),
    );
    const { context } = createContext("POST", "/v1/workspaces/workspace_1/projects", {
      headers: { "content-type": "multipart/form-data; boundary=test" },
    });
    Object.defineProperty(context.req, "bodyJson", {
      get() {
        throw new Error("multipart body must not be parsed");
      },
    });

    await routeRequest(context, {
      ...dependencies,
      projectAdministration: { handle },
    });

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ body: undefined }));
  });

  it("BDD-API-002 fails closed for an unknown operation", async () => {
    const { context, json } = createContext("POST", "/unknown", {
      headers: { "content-type": "multipart/form-data; boundary=unknown" },
    });
    Object.defineProperty(context.req, "bodyJson", {
      get() {
        throw new Error("multipart must not be parsed as JSON");
      },
    });

    await routeRequest(context, {
      ...dependencies,
      publicApi: { handle: () => Promise.resolve(null) },
    });

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith(
      { error: "not_found" },
      404,
      expect.objectContaining({
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
      }),
    );
    expect(context.log).toHaveBeenCalledWith(expect.not.stringContaining("/unknown"));
  });

  it("does not parse a body for a non-POST conversation probe", async () => {
    const { context, json } = createContext("GET", "/unknown");
    const handle = vi.fn(() => Promise.resolve(undefined));
    await routeRequest(context, {
      ...dependencies,
      conversationLifecycle: { handle },
    });
    expect(handle).toHaveBeenCalledWith({
      method: "GET",
      path: "/unknown",
      headers: {},
      body: undefined,
    });
    expect(json).toHaveBeenCalledWith({ error: "not_found" }, 404, expect.any(Object));
  });

  it("BDD-API-003 delegates safe request fields to the public capability", async () => {
    const body = { clientOperationId: "operation" };
    const handle = vi.fn(() =>
      Promise.resolve({ statusCode: 201, body: { status: "accepted" } }),
    );
    const publicApi: PublicApi = {
      handle,
    };
    const { context, json } = createContext("POST", "/v1/projects/wisemoney/feedback", {
      headers: { Authorization: "FeedbackProof secret-proof" },
      bodyJson: body,
    });

    await routeRequest(context, { ...dependencies, publicApi });

    expect(handle).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { Authorization: "FeedbackProof secret-proof" },
      body,
    });
    expect(json).toHaveBeenCalledWith(
      { status: "accepted" },
      201,
      expect.objectContaining({
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
      }),
    );
    const event = vi.mocked(context.log).mock.calls[0]?.[0] ?? "";
    expect(event).toContain('"operation":"public_api"');
    expect(event).not.toContain("wisemoney");
    expect(event).not.toContain("secret-proof");
  });

  it("BDD-SRC-REAL-002 delegates callback query fields only to the source boundary", async () => {
    const sourceHandle = vi.fn(() =>
      Promise.resolve({
        statusCode: 200,
        body: { status: "pending_selection", connectionId: "connection_1" },
      }),
    );
    const publicHandle = vi.fn<PublicApi["handle"]>();
    const { context, json } = createContext("GET", "/providers/github/callback", {
      query: { state: "opaque.state", code: "one-use-code" },
    });

    await routeRequest(context, {
      ...dependencies,
      sourceConnections: { handle: sourceHandle },
      publicApi: { handle: publicHandle },
    });

    expect(sourceHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        query: { state: "opaque.state", code: "one-use-code" },
      }),
    );
    expect(publicHandle).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      { status: "pending_selection", connectionId: "connection_1" },
      200,
      expect.objectContaining({ "cache-control": "no-store" }),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.not.stringMatching(/opaque|one-use|callback/u),
    );
  });

  it("BDD-SRC-REAL-005 defaults absent query and excludes multipart bodies", async () => {
    const sourceHandle = vi.fn(() => Promise.resolve(null));
    const { context } = createContext("POST", "/providers/upload", {
      headers: { "content-type": "multipart/form-data; boundary=test" },
      bodyJson: { prohibited: true },
    });
    await routeRequest(context, {
      ...dependencies,
      sourceConnections: { handle: sourceHandle },
    });
    expect(sourceHandle).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", query: {}, body: undefined }),
    );
    const { context: jsonContext } = createContext("POST", "/providers/upload", {
      headers: { "content-type": "application/json" },
      bodyJson: { repositoryIds: ["repository_1"] },
    });
    await routeRequest(jsonContext, {
      ...dependencies,
      sourceConnections: { handle: sourceHandle },
    });
    expect(sourceHandle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        body: { repositoryIds: ["repository_1"] },
      }),
    );
  });

  it("records a rejected public outcome without requiring headers", async () => {
    const publicApi: PublicApi = {
      handle: () =>
        Promise.resolve({
          statusCode: 400,
          body: { error: "ERR-INTAKE-INVALID" },
        }),
    };
    const { context, json } = createContext("POST", "/v1/public");

    await routeRequest(context, { ...dependencies, publicApi });

    expect(json).toHaveBeenCalledWith(
      { error: "ERR-INTAKE-INVALID" },
      400,
      expect.any(Object),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"rejected"'),
    );
  });

  it("BDD-ATT-DEPLOYED-005 returns private bytes with safe download headers", async () => {
    const bytes = new TextEncoder().encode("private evidence");
    const publicApi: PublicApi = {
      handle: () =>
        Promise.resolve({
          statusCode: 200,
          binary: {
            bytes,
            displayName: 'preuve épargne "août".txt',
            mediaType: "text/plain; charset=utf-8",
          },
        }),
    };
    const { binary, context, json } = createContext(
      "POST",
      "/v1/feedback/attachments/download",
    );

    await routeRequest(context, { ...dependencies, publicApi });

    expect(json).not.toHaveBeenCalled();
    expect(binary).toHaveBeenCalledWith(
      Buffer.from(bytes),
      200,
      expect.objectContaining({
        "cache-control": "no-store",
        "content-disposition":
          "attachment; filename*=UTF-8''preuve%20%C3%A9pargne%20%22ao%C3%BBt%22.txt",
        "content-length": String(bytes.byteLength),
        "content-type": "text/plain; charset=utf-8",
        "x-correlation-id": correlationId,
      }),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.not.stringMatching(/private evidence|preuve|attachment\/download/u),
    );
  });

  it("fails closed when the runtime cannot emit a binary response", async () => {
    const publicApi: PublicApi = {
      handle: () =>
        Promise.resolve({
          statusCode: 200,
          binary: {
            bytes: new Uint8Array([1]),
            displayName: "evidence.txt",
            mediaType: "text/plain; charset=utf-8",
          },
        }),
    };
    const { context, json } = createContext("POST", "/download");
    delete (context.res as { binary?: unknown }).binary;

    await routeRequest(context, { ...dependencies, publicApi });

    expect(json).toHaveBeenCalledWith(
      { error: "ERR-ATTACHMENT-UNAVAILABLE" },
      503,
      expect.objectContaining({ "cache-control": "no-store" }),
    );
  });

  it("routes trusted workbench responses before the public API", async () => {
    const workbench = {
      handle: vi.fn().mockResolvedValue({
        statusCode: 200,
        body: { status: "ok", result: [] },
      }),
    };
    const publicHandle = vi.fn();
    const publicApi: PublicApi = { handle: publicHandle };
    const { context, json } = createContext(
      "POST",
      "/v1/workspaces/workspace_1/projects/project_1/workbench/feedback_1",
      {
        headers: { "content-type": "application/json" },
        bodyJson: { kind: "delete_feedback" },
      },
    );

    await routeRequest(context, { ...dependencies, workbench, publicApi });

    expect(workbench.handle).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", body: { kind: "delete_feedback" } }),
    );
    expect(publicHandle).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      { status: "ok", result: [] },
      200,
      expect.objectContaining({ "cache-control": "no-store" }),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('"operation":"workbench"'),
    );

    const multipart = createContext("POST", context.req.path, {
      headers: { "content-type": "multipart/form-data; boundary=test" },
      bodyJson: { ignored: true },
    });
    await routeRequest(multipart.context, { ...dependencies, workbench });
    expect(workbench.handle).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "POST", body: undefined }),
    );
  });
});
