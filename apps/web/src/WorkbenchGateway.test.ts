import { describe, expect, it, vi } from "vitest";

import { createHttpWorkbenchGateway } from "./WorkbenchGateway";

describe("HTTP Workbench gateway", () => {
  const notification = {
    id: "notification_1",
    eventId: "event_1",
    feedbackId: "feedback_1",
    kind: "feedback_resolved",
    reference: "Y7-NOTIFY-12345678",
    locale: "fr",
    createdAt: "2026-08-28T10:00:00.000Z",
    readAt: null,
  };
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

  it("BDD-NOT-WEB-002 reads the scoped feed and marks a notification read", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          status: "ok",
          data: { items: [notification], unreadCount: 1 },
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ status: "ok", data: { status: "read" } }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          status: "ok",
          data: { databaseId: "feedback", tableId: "notification_signals" },
        }),
        { status: 200 },
      ),
    ];
    const fetcher = vi.fn(() => Promise.resolve(responses.shift() ?? new Response()));
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const scope = { workspaceId: "workspace_1", projectId: "project_1" };
    await expect(gateway.notifications(scope)).resolves.toEqual({
      status: "ok",
      result: { items: [notification], unreadCount: 1 },
    });
    await expect(
      gateway.markNotificationRead({ ...scope, notificationId: "notification_1" }),
    ).resolves.toEqual({ status: "ok", result: { status: "read" } });
    await expect(gateway.authorizeNotificationRealtime(scope)).resolves.toEqual({
      status: "ok",
      result: { databaseId: "feedback", tableId: "notification_signals" },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("operations/notifications/read"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ notificationId: "notification_1" }),
      }),
    );
  });

  it("accepts every notification event and an idempotent read outcome", async () => {
    const kinds = [
      "feedback_received",
      "message_added",
      "feedback_under_review",
      "clarification_requested",
      "reporter_answered",
      "feedback_resolved",
      "feedback_closed",
      "feedback_reopened",
      "assignment_changed",
    ] as const;
    const items = kinds.map((kind, index) => ({
      ...notification,
      id: `notification_${String(index)}`,
      eventId: `event_${String(index)}`,
      kind,
      locale: index % 2 === 0 ? ("fr" as const) : ("en" as const),
      readAt: "2026-08-28T10:01:00.000Z",
    }));
    const responses = [
      new Response(JSON.stringify({ status: "ok", data: { items, unreadCount: 0 } })),
      new Response(JSON.stringify({ status: "ok", data: { status: "already_read" } })),
    ];
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () => Promise.resolve(responses.shift() ?? new Response()),
    );
    const scope = { workspaceId: "workspace_1", projectId: "project_1" };
    await expect(gateway.notifications(scope)).resolves.toMatchObject({ status: "ok" });
    await expect(
      gateway.markNotificationRead({ ...scope, notificationId: "notification_1" }),
    ).resolves.toEqual({
      status: "ok",
      result: { status: "already_read" },
    });
  });

  it.each([
    null,
    { items: null, unreadCount: 0 },
    { items: [], unreadCount: "0" },
    { items: [], unreadCount: -1 },
    { items: [], unreadCount: 0.5 },
    { items: [notification], unreadCount: 2 },
    { items: [notification], unreadCount: 0 },
    { items: [null], unreadCount: 1 },
    { items: [{ ...notification, id: 1 }], unreadCount: 1 },
    { items: [{ ...notification, eventId: 1 }], unreadCount: 1 },
    { items: [{ ...notification, feedbackId: 1 }], unreadCount: 1 },
    { items: [{ ...notification, kind: "private_note" }], unreadCount: 1 },
    { items: [{ ...notification, reference: 1 }], unreadCount: 1 },
    { items: [{ ...notification, locale: "es" }], unreadCount: 1 },
    { items: [{ ...notification, createdAt: 1 }], unreadCount: 1 },
    { items: [{ ...notification, createdAt: "bad" }], unreadCount: 1 },
    { items: [{ ...notification, readAt: 1 }], unreadCount: 0 },
    { items: [{ ...notification, readAt: "bad" }], unreadCount: 0 },
  ])("fails closed for malformed notification feed %#", async (data) => {
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () => Promise.resolve(new Response(JSON.stringify({ status: "ok", data }))),
    );
    await expect(
      gateway.notifications({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("fails closed for a malformed notification read response", async () => {
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ status: "ok", data: { status: "wrong" } })),
        ),
    );
    await expect(
      gateway.markNotificationRead({
        workspaceId: "workspace_1",
        projectId: "project_1",
        notificationId: "notification_1",
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it.each([
    null,
    { databaseId: 1, tableId: "notification_signals" },
    { databaseId: "feedback", tableId: 1 },
  ])("fails closed for malformed realtime authorization %#", async (data) => {
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () => Promise.resolve(new Response(JSON.stringify({ status: "ok", data }))),
    );
    await expect(
      gateway.authorizeNotificationRealtime({
        workspaceId: "workspace_1",
        projectId: "project_1",
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

  it("reads detail, executes commands and maps trusted transport outcomes", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          status: "ok",
          result: {
            feedbackId: "feedback_1",
            type: "suggestion",
            state: "under_review",
            acceptedAt: "2026-08-28T10:00:00.000Z",
            assignedPrincipalIds: ["maintainer_1"],
            source: {
              type: "suggestion",
              proposal: "Add export",
              rationale: "Operators need portable evidence",
            },
            context: [
              {
                name: "retryCount",
                value: 2,
                purpose: "Diagnose",
                source: "system_observed",
                trust: "verified",
              },
            ],
            attachmentNames: ["trace.txt"],
            classification: "Product",
            assignedMaintainerId: "maintainer_1",
          },
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ status: "ok", result: { status: "applied" } }), {
        status: 200,
      }),
      new Response("{}", { status: 404 }),
      new Response("{}", { status: 400 }),
      new Response("{}", { status: 409 }),
    ];
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      () => {
        const response = responses.shift();
        if (response === undefined) throw new Error("missing test response");
        return Promise.resolve(response);
      },
    );
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test/",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const scoped = {
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
    };
    await expect(gateway.read(scoped)).resolves.toMatchObject({
      status: "ok",
      result: { classification: "Product", context: [{ value: 2 }] },
    });
    await expect(
      gateway.execute({ ...scoped, command: { kind: "delete_feedback" } }),
    ).resolves.toMatchObject({ status: "ok" });
    const executeInit = fetcher.mock.calls[1]?.[1];
    expect(executeInit?.method).toBe("POST");
    expect(executeInit?.headers).toEqual({
      authorization: "Bearer jwt_1",
      "content-type": "application/json",
    });
    await expect(gateway.read(scoped)).resolves.toEqual({ status: "denied" });
    await expect(gateway.read(scoped)).resolves.toEqual({ status: "invalid" });
    await expect(gateway.read(scoped)).resolves.toEqual({ status: "conflict" });
  });

  it("fails closed for unavailable identity, network and malformed conversations", async () => {
    const input = {
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
    };
    const denied = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.reject(new Error("session")),
      vi.fn(),
    );
    await expect(denied.read(input)).resolves.toEqual({ status: "denied" });

    const unavailable = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () => Promise.reject(new Error("network")),
    );
    await expect(unavailable.read(input)).resolves.toEqual({ status: "retryable" });

    const serverFailure = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      () => Promise.resolve(new Response("{}", { status: 500 })),
    );
    await expect(serverFailure.read(input)).resolves.toEqual({ status: "retryable" });

    for (const conversation of [
      null,
      {
        feedbackId: "feedback_1",
        state: "invented",
        messages: [],
        internalNotes: [],
        lifecycle: [],
      },
      {
        feedbackId: "feedback_1",
        state: "received",
        messages: [null],
        internalNotes: [],
        lifecycle: [],
      },
      {
        feedbackId: "feedback_1",
        state: "received",
        messages: [],
        internalNotes: [null],
        lifecycle: [],
      },
      {
        feedbackId: "feedback_1",
        state: "received",
        messages: [],
        internalNotes: [],
        lifecycle: [null],
      },
    ]) {
      const gateway = createHttpWorkbenchGateway(
        "https://api.example.test",
        () => Promise.resolve("jwt_1"),
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ status: "ok", conversation }), {
              status: 200,
            }),
          ),
      );
      await expect(gateway.conversation(input)).resolves.toEqual({
        status: "retryable",
      });
    }
  });

  it("accepts every supported inbox type and lifecycle state with time filters", async () => {
    const entries = [
      ["feedback_1", "bug", "received"],
      ["feedback_2", "suggestion", "under_review"],
      ["feedback_3", "review", "awaiting_reporter"],
      ["feedback_4", "bug", "resolved"],
      ["feedback_5", "review", "closed"],
    ].map(([feedbackId, type, state]) => ({
      feedbackId,
      type,
      state,
      acceptedAt: "2026-08-28T10:00:00.000Z",
      assignedPrincipalIds: [],
    }));
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", result: entries }), {
          status: 200,
        }),
      ),
    );
    const gateway = createHttpWorkbenchGateway(
      "https://api.example.test",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const outcome = await gateway.list({
      workspaceId: "workspace_1",
      projectId: "project_1",
      filter: {
        types: ["bug", "suggestion", "review"],
        states: ["received", "under_review", "awaiting_reporter", "resolved", "closed"],
        assignment: "all",
        acceptedFrom: "2026-08-01T00:00:00.000Z",
        acceptedTo: "2026-08-31T23:59:59.000Z",
      },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.result).toEqual(entries);
    expect(fetcher.mock.calls[0]?.[0]).toContain("acceptedFrom=");
    expect(fetcher.mock.calls[0]?.[0]).toContain("acceptedTo=");
  });
});
