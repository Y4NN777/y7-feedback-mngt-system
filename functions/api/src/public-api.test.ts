import { describe, expect, it, vi } from "vitest";

import type {
  ProjectFeedbackConfig,
  ReporterFeedbackView,
  ValidatedFeedbackDraft,
} from "@y7-feedback/domain";

import type { AccountlessAccessCoordinator } from "./accountless-access";
import type { IntakeCommand, IntakeCoordinator } from "./intake";
import {
  createPublicApi,
  type PublicProject,
  type PublicProjectReader,
} from "./public-api";

const projectConfig: ProjectFeedbackConfig = {
  projectId: "project-authoritative",
  workspaceId: "workspace-authoritative",
  active: true,
  enabledTypes: ["bug", "suggestion", "review"],
  contextDeclarations: [
    {
      name: "applicationVersion",
      type: "string",
      purpose: "Identifier la version concernée",
    },
  ],
};

const project: PublicProject = {
  slug: "wisemoney",
  feedbackConfig: projectConfig,
  reporterPurpose: {
    fr: "Recontacter la personne au sujet de ce retour",
    en: "Contact the person about this feedback",
  },
};

function bugBody() {
  return {
    clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
    locale: "fr",
    workspaceId: "forged-workspace",
    projectId: "forged-project",
    feedback: {
      type: "bug",
      source: {
        type: "bug",
        problem: "Le solde affiché est incorrect.",
        expectedBehavior: "Afficher le solde à jour.",
      },
      reporter: {
        kind: "contact",
        value: "personne@example.test",
        purpose: "forged-purpose",
        trust: "verified",
      },
      context: [
        {
          name: "applicationVersion",
          value: "2.4.1",
          source: "system_observed",
          assertionVerified: true,
        },
      ],
      attachmentNames: [],
    },
  };
}

function reporterView(): ReporterFeedbackView {
  return {
    feedbackId: "feedback-1",
    reference: "Y7-2026-000001",
    originalSource: { type: "bug", problem: "Le solde est incorrect." },
    currentSource: { type: "bug", problem: "Le solde est incorrect." },
    currentState: "received",
    history: [],
    messages: [],
    attachments: [],
    sourceRevisions: [],
    deletionRequests: [],
  };
}

function setup(
  options: {
    readonly resolvedProject?: PublicProject | null;
    readonly intakeOutcome?: Awaited<ReturnType<IntakeCoordinator["accept"]>>;
    readonly retrieveOutcome?: Awaited<
      ReturnType<AccountlessAccessCoordinator["retrieve"]>
    >;
  } = {},
) {
  const accept = vi.fn<
    (command: IntakeCommand) => ReturnType<IntakeCoordinator["accept"]>
  >(() =>
    Promise.resolve(
      options.intakeOutcome ?? {
        status: "accepted",
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: false,
      },
    ),
  );
  const retrieve = vi.fn<AccountlessAccessCoordinator["retrieve"]>(() =>
    Promise.resolve(options.retrieveOutcome ?? { status: "ok", view: reporterView() }),
  );
  const findBySlug = vi.fn(() =>
    Promise.resolve(
      options.resolvedProject === undefined ? project : options.resolvedProject,
    ),
  );
  const projects: PublicProjectReader = { findBySlug };
  const intake: IntakeCoordinator = { accept };
  const access: AccountlessAccessCoordinator = {
    retrieve,
    rotate: () => Promise.resolve({ status: "denied", code: "ACCESS_DENIED" }),
    revoke: () => Promise.resolve({ status: "denied", code: "ACCESS_DENIED" }),
    act: () => Promise.resolve({ status: "denied", code: "ACCESS_DENIED" }),
  };
  return {
    access,
    accept,
    api: createPublicApi(projects, intake, access),
    findBySlug,
    projects,
    retrieve,
  };
}

describe("trusted public Function boundary", () => {
  it("BDD-PUBLIC-INTAKE-001 derives scope and trust before transactional acceptance", async () => {
    const { api, accept, findBySlug } = setup();

    const response = await api.handle({
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { "content-type": "application/json" },
      body: bugBody(),
    });

    expect(response).toEqual({
      statusCode: 201,
      body: {
        status: "accepted",
        reference: "Y7-2026-000001",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: false,
      },
    });
    expect(findBySlug).toHaveBeenCalledWith("wisemoney");
    expect(accept).toHaveBeenCalledOnce();
    const command = accept.mock.calls[0]?.[0];
    expect(command?.draft).toEqual(
      expect.objectContaining<Partial<ValidatedFeedbackDraft>>({
        workspaceId: "workspace-authoritative",
        projectId: "project-authoritative",
        reporter: {
          kind: "contact",
          value: "personne@example.test",
          purpose: project.reporterPurpose.fr,
        },
        context: [
          {
            name: "applicationVersion",
            value: "2.4.1",
            purpose: "Identifier la version concernée",
            source: "public",
            trust: "unverified",
          },
        ],
      }),
    );
    expect(JSON.stringify(response)).not.toContain("feedback-1");
  });

  it("maps replay, conflict, and dependency failure without exposing prior success", async () => {
    const replay = setup({
      intakeOutcome: {
        status: "accepted",
        feedbackId: "feedback-1",
        reference: "Y7-2026-000001",
        accessProof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        replayed: true,
      },
    });
    await expect(
      replay.api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toMatchObject({ statusCode: 200, body: { replayed: true } });

    for (const [outcome, expected] of [
      [
        { status: "rejected" as const, code: "OPERATION_CONFLICT" as const },
        { statusCode: 409, body: { error: "ERR-OPERATION-CONFLICT" } },
      ],
      [
        { status: "retryable" as const, code: "INTAKE_UNAVAILABLE" as const },
        { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } },
      ],
    ] as const) {
      const { api } = setup({ intakeOutcome: outcome });
      const response = await api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      });
      expect(response).toEqual(expected);
      expect(response).not.toHaveProperty("reference");
    }
  });

  it("fails closed before persistence for malformed, forged-trust, and file-manifest input", async () => {
    const { api, accept } = setup();
    const invalidBodies = [
      null,
      { ...bugBody(), clientOperationId: "not-an-operation" },
      {
        ...bugBody(),
        feedback: {
          ...bugBody().feedback,
          reporter: {
            kind: "assertion",
            value: "external-1",
            issuer: "forged",
            applicationId: "forged",
            assertionVerified: true,
          },
        },
      },
      {
        ...bugBody(),
        feedback: { ...bugBody().feedback, attachmentNames: ["evidence.png"] },
      },
      {
        ...bugBody(),
        feedback: {
          ...bugBody().feedback,
          source: { type: "suggestion", proposal: "Mismatch", rationale: "Bad" },
        },
      },
    ];

    for (const body of invalidBodies) {
      await expect(
        api.handle({
          method: "POST",
          path: "/v1/projects/wisemoney/feedback",
          headers: {},
          body,
        }),
      ).resolves.toEqual({
        statusCode: 400,
        body: { error: "ERR-INTAKE-INVALID" },
      });
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it("accepts every declared public variant and rejects parser edge cases", async () => {
    const validBodies = [
      {
        ...bugBody(),
        locale: "en",
        feedback: {
          ...bugBody().feedback,
          source: {
            type: "bug",
            problem: "Broken",
            observedBehavior: "Observed",
            reproductionSteps: "Open the page",
          },
          reporter: { kind: "unidentified" },
          context: [{ name: "applicationVersion", value: 24 }],
        },
      },
      {
        ...bugBody(),
        locale: undefined,
        feedback: {
          ...bugBody().feedback,
          type: "suggestion",
          source: {
            type: "suggestion",
            proposal: "Add export",
            rationale: "Save time",
            usageContext: "Monthly reporting",
          },
          reporter: {
            kind: "external",
            value: "external-42",
            issuer: "partner",
            applicationId: "finance-app",
          },
          context: [{ name: "applicationVersion", value: true }],
        },
      },
      {
        ...bugBody(),
        feedback: {
          ...bugBody().feedback,
          type: "review",
          source: {
            type: "review",
            experience: "Fast",
            appreciation: "Useful",
          },
        },
      },
      {
        ...bugBody(),
        feedback: {
          ...bugBody().feedback,
          type: "suggestion",
          source: {
            type: "suggestion",
            proposal: "Add export",
            rationale: "Save time",
          },
        },
      },
    ];
    for (const body of validBodies) {
      const contextValue = body.feedback.context[0]?.value;
      const contextType = typeof contextValue;
      const { api } = setup({
        resolvedProject: {
          ...project,
          feedbackConfig: {
            ...project.feedbackConfig,
            contextDeclarations: [
              {
                name: "applicationVersion",
                purpose: "Identifier la version concernée",
                type:
                  contextType === "number" || contextType === "boolean"
                    ? contextType
                    : "string",
              },
            ],
          },
        },
      });
      await expect(
        api.handle({
          method: "POST",
          path: "/v1/projects/wisemoney/feedback",
          headers: {},
          body,
        }),
      ).resolves.toMatchObject({ statusCode: 201 });
    }

    const base = bugBody();
    const invalidFeedbacks = [
      null,
      { ...base.feedback, type: "question" },
      { ...base.feedback, source: null },
      { ...base.feedback, source: { ...base.feedback.source, problem: 42 } },
      { ...base.feedback, source: { ...base.feedback.source, problem: " " } },
      {
        ...base.feedback,
        source: { ...base.feedback.source, problem: "x".repeat(5_001) },
      },
      { ...base.feedback, reporter: null },
      { ...base.feedback, reporter: { kind: "unknown" } },
      { ...base.feedback, context: null },
      { ...base.feedback, context: Array.from({ length: 21 }, () => ({})) },
      { ...base.feedback, context: [null] },
      {
        ...base.feedback,
        context: [{ name: "applicationVersion", value: null }],
      },
      { ...base.feedback, context: [{ name: "undeclared", value: "x" }] },
    ];
    const invalidBodies = [
      ...invalidFeedbacks.map((feedback) => ({ ...base, feedback })),
      { ...base, locale: "de" },
      { ...base, clientOperationId: 42 },
    ];
    const { api, accept } = setup();
    for (const body of invalidBodies) {
      await expect(
        api.handle({
          method: "POST",
          path: "/v1/projects/wisemoney/feedback",
          headers: {},
          body,
        }),
      ).resolves.toEqual({
        statusCode: 400,
        body: { error: "ERR-INTAKE-INVALID" },
      });
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it("maps a domain rejection and an intake exception to safe outcomes", async () => {
    const rejected = setup({
      intakeOutcome: { status: "rejected", code: "INTAKE_INVALID" },
    });
    await expect(
      rejected.api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 400,
      body: { error: "ERR-INTAKE-INVALID" },
    });

    const failed = setup();
    failed.accept.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      failed.api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });
  });

  it("returns one neutral project outcome and a retryable registry failure", async () => {
    const missing = setup({ resolvedProject: null });
    await expect(
      missing.api.handle({
        method: "POST",
        path: "/v1/projects/unknown/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PROJECT-UNAVAILABLE" },
    });

    const failedReader: PublicProjectReader = {
      findBySlug: () => Promise.reject(new Error("database unavailable")),
    };
    const available = setup();
    const api = createPublicApi(
      failedReader,
      { accept: available.accept },
      available.access,
    );
    await expect(
      api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });

    const invalidConfiguration = setup({
      resolvedProject: {
        ...project,
        reporterPurpose: { ...project.reporterPurpose, fr: " " },
      },
    });
    await expect(
      invalidConfiguration.api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });

    const mismatchedProject = setup({
      resolvedProject: { ...project, slug: "another-project" },
    });
    await expect(
      mismatchedProject.api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: {},
        body: bugBody(),
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });
  });

  it("BDD-PUBLIC-ACCESS-001 reads proof only from authorization and returns the safe view", async () => {
    const { api, retrieve } = setup();
    const response = await api.handle({
      method: "POST",
      path: "/v1/feedback/retrieve",
      headers: {
        authorization:
          "FeedbackProof proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
      },
      body: {
        reference: "Y7-2026-000001",
        proof: "forged-body-proof",
      },
    });

    expect(retrieve).toHaveBeenCalledWith({
      reference: "Y7-2026-000001",
      proof: "proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
    });
    expect(response).toEqual({
      statusCode: 200,
      body: { status: "ok", feedback: reporterView() },
    });
    expect(JSON.stringify(response)).not.toContain("forged-body-proof");
  });

  it("uses one denial for malformed, reference-only, and unknown access, with distinct retry", async () => {
    const invalid = setup();
    for (const request of [
      { headers: {}, body: { reference: "Y7-2026-000001" } },
      {
        headers: { authorization: "Bearer unrelated" },
        body: { reference: "Y7-2026-000001" },
      },
      {
        headers: {
          authorization:
            "FeedbackProof proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
        },
        body: null,
      },
    ]) {
      await expect(
        invalid.api.handle({
          method: "POST",
          path: "/v1/feedback/retrieve",
          ...request,
        }),
      ).resolves.toEqual({
        statusCode: 404,
        body: { error: "ERR-ACCESS-DENIED" },
      });
    }
    expect(invalid.retrieve).not.toHaveBeenCalled();

    const denied = setup({
      retrieveOutcome: { status: "denied", code: "ACCESS_DENIED" },
    });
    const retryable = setup({
      retrieveOutcome: { status: "retryable", code: "ACCESS_UNAVAILABLE" },
    });
    const request = {
      method: "POST",
      path: "/v1/feedback/retrieve",
      headers: {
        authorization:
          "FeedbackProof proof_abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG",
      },
      body: { reference: "Y7-2026-000001" },
    };
    await expect(denied.api.handle(request)).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-ACCESS-DENIED" },
    });
    await expect(retryable.api.handle(request)).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-ACCESS-UNAVAILABLE" },
    });

    const failed = setup();
    failed.retrieve.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(failed.api.handle(request)).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-ACCESS-UNAVAILABLE" },
    });
  });

  it("returns null for routes outside the public API capability", async () => {
    const { api } = setup();
    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: null }),
    ).resolves.toBeNull();
  });
});
