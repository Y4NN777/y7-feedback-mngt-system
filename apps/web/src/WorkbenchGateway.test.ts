import { describe, expect, it, vi } from "vitest";

import { createHttpWorkbenchGateway } from "./WorkbenchGateway";

describe("HTTP Workbench gateway", () => {
  it("BDD-WORK-WEB-001 sends scoped filters with a temporary JWT", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          result: [
            {
              feedbackId: "feedback_1",
              type: "bug",
              state: "received",
              acceptedAt: "2026-08-28T10:00:00.000Z",
              assignedPrincipalIds: [],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );

    await expect(
      gateway.list({
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: ["bug"], states: ["received"], assignment: "unassigned" },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("type=bug&state=received&assignment=unassigned"),
      expect.objectContaining({ headers: { authorization: "Bearer jwt_1" } }),
    );
  });

  it("BDD-WORK-WEB-002 fails closed on a malformed projection", async () => {
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () =>
        Promise.resolve(new Response(JSON.stringify({ result: [{ type: "bug" }] }))),
    );
    await expect(
      gateway.list({
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("BDD-WORK-WEB-007 parses the workspace-only conversation projection", async () => {
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ok",
              conversation: {
                feedbackId: "feedback_1",
                state: "received",
                messages: [],
                internalNotes: [
                  {
                    id: "note_1",
                    actorKind: "workspace",
                    audience: "workspace",
                    occurredAt: "2026-08-28T10:00:00.000Z",
                    content: "Internal evidence",
                  },
                ],
                lifecycle: [],
              },
            }),
          ),
        ),
    );
    await expect(
      gateway.conversation({
        workspaceId: "workspace_1",
        projectId: "project_1",
        feedbackId: "feedback_1",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { internalNotes: [{ content: "Internal evidence" }] },
    });
  });
});
