import { describe, expect, it } from "vitest";

import {
  FeedbackPolicyError,
  ReporterPolicyError,
  createReporterRegistry,
  validateFeedbackDraft,
  validateProjectFeedbackConfig,
  type FeedbackDraft,
  type ProjectFeedbackConfig,
} from "./index";

function reporterRegistry() {
  let sequence = 0;
  return createReporterRegistry({
    nextReporterId: () => `reporter-${String(++sequence)}`,
    now: () => "2026-08-10T12:00:00.000Z",
  });
}

describe("Workspace-scoped Reporter attribution", () => {
  it("BDD-REP-001 creates distinct unidentified Reporters", () => {
    const registry = reporterRegistry();
    const first = registry.attribute("workspace-one", { kind: "unidentified" });
    const second = registry.attribute("workspace-one", { kind: "unidentified" });

    expect(first.reporter.id).not.toBe(second.reporter.id);
    expect(first.reporter.identifiers).toEqual([]);
    expect(first.decision).toBe("created");
    expect(JSON.stringify(first)).not.toMatch(/fingerprint|device|browser/iu);
  });

  it("BDD-REP-002 does not merge unverified contact or public external ID", () => {
    const registry = reporterRegistry();
    const contact = {
      kind: "contact" as const,
      value: "reporter@example.test",
      purpose: "Submission follow-up",
    };
    const external = {
      kind: "external" as const,
      value: "external-42",
      issuer: "issuer-one",
      applicationId: "application-one",
      purpose: "Link feedback from the client application",
    };

    expect(
      registry.attribute("workspace-one", contact).reporter.identifiers[0],
    ).toMatchObject({
      trust: "unverified",
      purpose: "Submission follow-up",
    });
    expect(registry.attribute("workspace-one", contact).decision).toBe("created");
    expect(
      registry.attribute("workspace-one", external).reporter.identifiers[0],
    ).toMatchObject({
      trust: "unverified",
      source: "public",
    });
    expect(registry.attribute("workspace-one", external).decision).toBe("created");
  });

  it("BDD-REP-003 matches verified assertions only in exact scope", () => {
    const registry = reporterRegistry();
    const assertion = {
      kind: "assertion" as const,
      value: "external-42",
      issuer: "issuer-one",
      applicationId: "application-one",
      purpose: "Verified client continuity",
      assertionVerified: true as const,
    };
    const first = registry.attribute("workspace-one", assertion);
    const same = registry.attribute("workspace-one", assertion);
    const otherIssuer = registry.attribute("workspace-one", {
      ...assertion,
      issuer: "issuer-two",
    });
    const otherApplication = registry.attribute("workspace-one", {
      ...assertion,
      applicationId: "application-two",
    });
    const otherWorkspace = registry.attribute("workspace-two", assertion);

    expect(same).toMatchObject({
      decision: "matched",
      reporter: { id: first.reporter.id },
    });
    expect(
      new Set(
        [first, otherIssuer, otherApplication, otherWorkspace].map(
          (item) => item.reporter.id,
        ),
      ).size,
    ).toBe(4);
  });

  it("BDD-REP-004 records controlled history and denies cross-Workspace changes", () => {
    const registry = reporterRegistry();
    const first = registry.attribute("workspace-one", { kind: "unidentified" });
    const second = registry.attribute("workspace-one", { kind: "unidentified" });

    const history = registry.changeAttribution({
      workspaceId: "workspace-one",
      priorReporterId: first.reporter.id,
      resultingReporterId: second.reporter.id,
      operation: "link",
      reason: "Reporter supplied approved continuity evidence",
      actor: "trusted-intake",
    });
    expect(history).toEqual({
      workspaceId: "workspace-one",
      priorReporterId: first.reporter.id,
      resultingReporterId: second.reporter.id,
      operation: "link",
      reason: "Reporter supplied approved continuity evidence",
      actor: "trusted-intake",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    expect(() => {
      registry.changeAttribution({
        workspaceId: "workspace-two",
        priorReporterId: first.reporter.id,
        resultingReporterId: second.reporter.id,
        operation: "merge",
        reason: "Invalid cross-scope attempt",
        actor: "trusted-intake",
      });
    }).toThrow(new ReporterPolicyError("REPORTER_SCOPE_DENIED"));
    expect(registry.history()).toEqual([history]);
  });

  it("BDD-REP-002 rejects malformed and unverified attribution", () => {
    const registry = reporterRegistry();
    expect(() => {
      registry.attribute("", { kind: "unidentified" });
    }).toThrow(new ReporterPolicyError("REPORTER_ATTRIBUTION_INVALID"));
    expect(() => {
      registry.attribute("workspace-one", {
        kind: "contact",
        value: "x".repeat(321),
        purpose: "Follow up",
      });
    }).toThrow(new ReporterPolicyError("REPORTER_ATTRIBUTION_INVALID"));
    expect(() => {
      registry.attribute("workspace-one", {
        kind: "assertion",
        value: "external-42",
        issuer: "issuer-one",
        applicationId: "application-one",
        purpose: "Continuity",
        assertionVerified: false,
      });
    }).toThrow(new ReporterPolicyError("REPORTER_ASSERTION_UNVERIFIED"));
  });

  it("BDD-REP-004 validates controlled change variants", () => {
    const registry = reporterRegistry();
    const first = registry.attribute("workspace-one", { kind: "unidentified" });
    const otherWorkspace = registry.attribute("workspace-two", {
      kind: "unidentified",
    });

    expect(
      registry.changeAttribution({
        workspaceId: "workspace-one",
        priorReporterId: first.reporter.id,
        resultingReporterId: null,
        operation: "anonymize",
        reason: "Approved anonymization",
        actor: "privacy-worker",
      }).resultingReporterId,
    ).toBeNull();

    for (const command of [
      {
        workspaceId: "workspace-one",
        priorReporterId: "missing",
        resultingReporterId: first.reporter.id,
        operation: "link" as const,
      },
      {
        workspaceId: "workspace-one",
        priorReporterId: first.reporter.id,
        resultingReporterId: "missing",
        operation: "merge" as const,
      },
      {
        workspaceId: "workspace-one",
        priorReporterId: first.reporter.id,
        resultingReporterId: otherWorkspace.reporter.id,
        operation: "correct" as const,
      },
      {
        workspaceId: "workspace-one",
        priorReporterId: first.reporter.id,
        resultingReporterId: first.reporter.id,
        operation: "anonymize" as const,
      },
    ]) {
      expect(() => {
        registry.changeAttribution({
          ...command,
          reason: "Controlled operation",
          actor: "trusted-worker",
        });
      }).toThrow(new ReporterPolicyError("REPORTER_SCOPE_DENIED"));
    }
  });
});

const projectConfig: ProjectFeedbackConfig = {
  projectId: "project-alpha",
  workspaceId: "workspace-one",
  active: true,
  enabledTypes: ["bug", "suggestion", "review"],
  contextDeclarations: [
    { name: "applicationVersion", type: "string", purpose: "Reproduce the issue" },
    { name: "retryCount", type: "number", purpose: "Understand frequency" },
  ],
};

const baseDraft = {
  reporter: { kind: "unidentified" as const },
  context: [],
  attachmentNames: [],
};

describe("Feedback source and Context validation", () => {
  it.each<FeedbackDraft>([
    {
      ...baseDraft,
      type: "bug",
      source: { type: "bug", problem: "The transfer cannot be confirmed" },
    },
    {
      ...baseDraft,
      type: "suggestion",
      source: {
        type: "suggestion",
        proposal: "Show the transfer fee before confirmation",
        rationale: "It helps compare the available options",
      },
    },
    {
      ...baseDraft,
      type: "review",
      source: {
        type: "review",
        experience: "The transfer completed as expected",
        appreciation: "The confirmation was clear",
      },
    },
  ])("BDD-FDB-001 accepts the enabled $type semantic source", (draft) => {
    expect(validateFeedbackDraft(projectConfig, draft)).toMatchObject({
      projectId: "project-alpha",
      originalSource: draft.source,
      type: draft.type,
    });
  });

  it("BDD-FDB-001 rejects disabled, missing, or redefined source semantics", () => {
    expect(() =>
      validateProjectFeedbackConfig({ ...projectConfig, enabledTypes: [] }),
    ).toThrow(new FeedbackPolicyError("PROJECT_TYPE_CONFIGURATION_INVALID"));
    expect(() =>
      validateFeedbackDraft(
        { ...projectConfig, enabledTypes: ["bug"] },
        {
          ...baseDraft,
          type: "suggestion",
          source: { type: "suggestion", proposal: "Change it", rationale: "Helpful" },
        },
      ),
    ).toThrow(new FeedbackPolicyError("FEEDBACK_TYPE_DISABLED"));
    expect(() =>
      validateFeedbackDraft(projectConfig, {
        ...baseDraft,
        type: "bug",
        source: { type: "bug", problem: "" },
      }),
    ).toThrow(new FeedbackPolicyError("SOURCE_INVALID"));
  });

  it("BDD-FDB-001 preserves optional Bug and Suggestion fields", () => {
    const bug = validateFeedbackDraft(projectConfig, {
      ...baseDraft,
      type: "bug",
      source: {
        type: "bug",
        problem: "Transfer fails",
        expectedBehavior: "Transfer completes",
        observedBehavior: "Confirmation never appears",
        reproductionSteps: "Open transfer and confirm",
      },
    });
    const suggestion = validateFeedbackDraft(projectConfig, {
      ...baseDraft,
      type: "suggestion",
      source: {
        type: "suggestion",
        proposal: "Show fees earlier",
        rationale: "It supports comparison",
        usageContext: "Before transfer confirmation",
      },
    });

    expect(bug.originalSource).toMatchObject({
      expectedBehavior: "Transfer completes",
    });
    expect(suggestion.originalSource).toMatchObject({
      usageContext: "Before transfer confirmation",
    });
  });

  it("BDD-FDB-001 rejects mismatched source, inactive intake, and bad manifests", () => {
    const bugDraft: FeedbackDraft = {
      ...baseDraft,
      type: "bug",
      source: { type: "bug", problem: "Transfer fails" },
    };
    expect(() => {
      validateFeedbackDraft({ ...projectConfig, active: false }, bugDraft);
    }).toThrow(new FeedbackPolicyError("FEEDBACK_TYPE_DISABLED"));
    expect(() => {
      validateFeedbackDraft(projectConfig, {
        ...bugDraft,
        source: {
          type: "suggestion",
          proposal: "Show fees",
          rationale: "Helpful",
        },
      } as unknown as FeedbackDraft);
    }).toThrow(new FeedbackPolicyError("SOURCE_INVALID"));
    for (const attachmentNames of [
      ["1", "2", "3", "4", "5", "6"],
      [""],
      ["x".repeat(256)],
    ]) {
      expect(() => {
        validateFeedbackDraft(projectConfig, { ...bugDraft, attachmentNames });
      }).toThrow(new FeedbackPolicyError("ATTACHMENT_MANIFEST_INVALID"));
    }
  });

  it("BDD-FDB-001 rejects invalid Project feedback configuration", () => {
    const invalidConfigurations = [
      { ...projectConfig, enabledTypes: ["bug", "bug"] as const },
      { ...projectConfig, enabledTypes: ["unknown"] as unknown as ["bug"] },
      {
        ...projectConfig,
        contextDeclarations: Array.from({ length: 21 }, (_, index) => ({
          name: `field${String(index)}`,
          type: "string" as const,
          purpose: "Declared purpose",
        })),
      },
      {
        ...projectConfig,
        contextDeclarations: [
          { name: "duplicate", type: "string" as const, purpose: "One" },
          { name: "duplicate", type: "string" as const, purpose: "Two" },
        ],
      },
      {
        ...projectConfig,
        contextDeclarations: [
          { name: "bad-name", type: "string" as const, purpose: "Purpose" },
        ],
      },
      {
        ...projectConfig,
        contextDeclarations: [
          { name: "validName", type: "string" as const, purpose: "" },
        ],
      },
      {
        ...projectConfig,
        contextDeclarations: [
          { name: "validName", type: "string" as const, purpose: "x".repeat(301) },
        ],
      },
      {
        ...projectConfig,
        contextDeclarations: [
          {
            name: "validName",
            type: "object" as unknown as "string",
            purpose: "Purpose",
          },
        ],
      },
    ];

    for (const config of invalidConfigurations) {
      expect(() => {
        validateProjectFeedbackConfig(config);
      }).toThrow(new FeedbackPolicyError("PROJECT_TYPE_CONFIGURATION_INVALID"));
    }
    expect(
      validateProjectFeedbackConfig({
        ...projectConfig,
        active: false,
        enabledTypes: [],
      }),
    ).toMatchObject({ active: false, enabledTypes: [] });
  });

  it("BDD-CTX-001 keeps declared Context source, purpose, type, and trust", () => {
    const validated = validateFeedbackDraft(projectConfig, {
      ...baseDraft,
      type: "bug",
      source: { type: "bug", problem: "The transfer cannot be confirmed" },
      context: [
        {
          name: "applicationVersion",
          value: "2.4.1",
          source: "public",
        },
        {
          name: "retryCount",
          value: 2,
          source: "client_assertion",
          assertionVerified: true,
        },
      ],
    });

    expect(validated.context).toEqual([
      {
        name: "applicationVersion",
        value: "2.4.1",
        purpose: "Reproduce the issue",
        source: "public",
        trust: "unverified",
      },
      {
        name: "retryCount",
        value: 2,
        purpose: "Understand frequency",
        source: "client_assertion",
        trust: "verified",
      },
    ]);
  });

  it.each([
    { name: "undeclared", value: "value", source: "public" as const },
    { name: "retryCount", value: "two", source: "public" as const },
    {
      name: "applicationVersion",
      value: "x".repeat(501),
      source: "public" as const,
    },
    {
      name: "applicationVersion",
      value: "<script>alert(1)</script>",
      source: "public" as const,
    },
  ])(
    "BDD-CTX-001 rejects undeclared, malformed, oversized, or executable Context",
    (contextInput) => {
      expect(() =>
        validateFeedbackDraft(projectConfig, {
          ...baseDraft,
          type: "bug",
          source: { type: "bug", problem: "The transfer cannot be confirmed" },
          context: [contextInput],
        }),
      ).toThrow(new FeedbackPolicyError("CONTEXT_INVALID"));
    },
  );

  it("BDD-FDB-002 preserves source separately from Context and classification", () => {
    const validated = validateFeedbackDraft(projectConfig, {
      ...baseDraft,
      type: "review",
      source: {
        type: "review",
        experience: "The transfer completed",
        appreciation: "Clear confirmation",
      },
    });

    expect(validated.originalSource).toEqual({
      type: "review",
      experience: "The transfer completed",
      appreciation: "Clear confirmation",
    });
    expect(validated.context).toEqual([]);
    expect(validated.derivedClassification).toBeNull();
  });

  it("BDD-CTX-001 validates bounded boolean/system and unverified client Context", () => {
    const config: ProjectFeedbackConfig = {
      ...projectConfig,
      contextDeclarations: [
        { name: "enabled", type: "boolean", purpose: "Reproduce configuration" },
        { name: "attempt", type: "number", purpose: "Understand retry" },
      ],
    };
    const validated = validateFeedbackDraft(config, {
      ...baseDraft,
      type: "bug",
      source: { type: "bug", problem: "Transfer fails" },
      context: [
        { name: "enabled", value: true, source: "system_observed" },
        { name: "attempt", value: 1, source: "client_assertion" },
      ],
    });

    expect(validated.context.map((item) => item.trust)).toEqual([
      "verified",
      "unverified",
    ]);
    expect(() => {
      validateFeedbackDraft(config, {
        ...baseDraft,
        type: "bug",
        source: { type: "bug", problem: "Transfer fails" },
        context: [{ name: "attempt", value: Number.NaN, source: "public" }],
      });
    }).toThrow(new FeedbackPolicyError("CONTEXT_INVALID"));
    expect(() => {
      validateFeedbackDraft(config, {
        ...baseDraft,
        type: "bug",
        source: { type: "bug", problem: "Transfer fails" },
        context: Array.from({ length: 21 }, () => ({
          name: "enabled",
          value: true,
          source: "public" as const,
        })),
      });
    }).toThrow(new FeedbackPolicyError("CONTEXT_INVALID"));
    expect(() => {
      validateFeedbackDraft(config, {
        ...baseDraft,
        type: "bug",
        source: { type: "bug", problem: "Transfer fails" },
        context: [
          { name: "enabled", value: true, source: "public" },
          { name: "enabled", value: false, source: "public" },
        ],
      });
    }).toThrow(new FeedbackPolicyError("CONTEXT_INVALID"));
  });
});
