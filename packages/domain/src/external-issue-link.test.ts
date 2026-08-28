import { describe, expect, it } from "vitest";

import {
  ExternalIssuePolicyError,
  createExternalIssueLinkRegistry,
  createPublicationConsentLedger,
  type ActorAccess,
  type ExternalIssueLinkCommand,
} from "./index";

const owner: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

const maintainer: ActorAccess = {
  principalId: "maintainer_1",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace_1"],
  projectIds: ["project_1"],
};

function command(
  overrides: Partial<ExternalIssueLinkCommand> = {},
): ExternalIssueLinkCommand {
  return {
    operationId: "operation_1",
    actor: maintainer,
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    assignedPrincipalIds: ["maintainer_1"],
    repository: {
      connectionId: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      repositoryId: "repository_1",
      visibility: "public",
      connectionState: "active",
      selected: true,
    },
    reference: "Y7-ABC123",
    protectedWorkspaceUrl: "https://y7.example.test/w/acme/p/product/f/Y7-ABC123",
    feedbackType: "bug",
    reporterContent: "The submit button does nothing.",
    consentVersion: undefined,
    ...overrides,
  };
}

describe("External issue publication consent", () => {
  it("BDD-ISSUE-001 versions grants and revocations without reactivating old consent", () => {
    const ledger = createPublicationConsentLedger();

    expect(
      ledger.grant({
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        disclosureVersion: "public-issue-v1",
        audience: "github:repository_1",
        occurredAt: "2026-08-28T12:00:00.000Z",
      }),
    ).toMatchObject({ version: 1, state: "active" });
    expect(
      ledger.revoke({
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        occurredAt: "2026-08-28T12:05:00.000Z",
      }),
    ).toMatchObject({ version: 2, state: "revoked" });
    expect(ledger.active("feedback_1", 1)).toBe(false);
    expect(ledger.active("feedback_1", 2)).toBe(false);
  });

  it("BDD-ISSUE-002 rejects an audience or reporter change during revocation", () => {
    const ledger = createPublicationConsentLedger();
    ledger.grant({
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      disclosureVersion: "public-issue-v1",
      audience: "github:repository_1",
      occurredAt: "2026-08-28T12:00:00.000Z",
    });

    expect(() =>
      ledger.revoke({
        feedbackId: "feedback_1",
        reporterId: "reporter_2",
        occurredAt: "2026-08-28T12:05:00.000Z",
      }),
    ).toThrow(new ExternalIssuePolicyError("CONSENT_SCOPE_DENIED"));
  });

  it("BDD-ISSUE-002A fails closed for invalid consent facts and scope changes", () => {
    const valid = {
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      disclosureVersion: "public-issue-v1",
      audience: "github:repository_1",
      occurredAt: "2026-08-28T12:00:00.000Z",
    } as const;

    for (const invalid of [
      { ...valid, feedbackId: "" },
      { ...valid, reporterId: "" },
      { ...valid, disclosureVersion: "" },
      { ...valid, audience: "" },
      { ...valid, occurredAt: "2026-08-28" },
    ]) {
      expect(() => createPublicationConsentLedger().grant(invalid)).toThrow(
        new ExternalIssuePolicyError("CONSENT_INVALID"),
      );
    }

    for (const changed of [
      { reporterId: "reporter_2" },
      { audience: "gitlab:repository_1" },
      { disclosureVersion: "public-issue-v2" },
    ]) {
      const ledger = createPublicationConsentLedger();
      ledger.grant(valid);
      expect(() => ledger.grant({ ...valid, ...changed })).toThrow(
        new ExternalIssuePolicyError("CONSENT_SCOPE_DENIED"),
      );
    }
  });

  it("BDD-ISSUE-002B evaluates only the latest exact consent fact", () => {
    const ledger = createPublicationConsentLedger();
    expect(ledger.active("feedback_missing", 1)).toBe(false);
    expect(() =>
      ledger.revoke({
        feedbackId: "feedback_missing",
        reporterId: "reporter_1",
        occurredAt: "invalid",
      }),
    ).toThrow(new ExternalIssuePolicyError("CONSENT_INVALID"));
    expect(() =>
      ledger.revoke({
        feedbackId: "feedback_missing",
        reporterId: "reporter_1",
        occurredAt: "2026-08-28T12:00:00.000Z",
      }),
    ).toThrow(new ExternalIssuePolicyError("CONSENT_SCOPE_DENIED"));

    const consent = ledger.grant({
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      disclosureVersion: "public-issue-v1",
      audience: "github:repository_1",
      occurredAt: "2026-08-28T12:00:00.000Z",
    });
    expect(ledger.active("feedback_1", consent.version + 1)).toBe(false);
    expect(ledger.active("feedback_1", consent.version, "github:other")).toBe(false);
    expect(ledger.active("feedback_1", consent.version)).toBe(true);
  });
});

describe("External issue link policy", () => {
  it("BDD-ISSUE-003 publishes only minimal allow-listed metadata publicly without consent", () => {
    const registry = createExternalIssueLinkRegistry(createPublicationConsentLedger());

    const result = registry.request(command());

    expect(result.link).toMatchObject({ state: "active", visibility: "public" });
    expect(result.outbox.payload).toEqual({
      reference: "Y7-ABC123",
      protectedWorkspaceUrl: "https://y7.example.test/w/acme/p/product/f/Y7-ABC123",
      feedbackType: "bug",
      origin: "y7-feedback",
    });
    expect(JSON.stringify(result.outbox)).not.toContain("submit button");
  });

  it("BDD-ISSUE-004 publishes Reporter content only for private repositories or active exact consent", () => {
    const ledger = createPublicationConsentLedger();
    const consent = ledger.grant({
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      disclosureVersion: "public-issue-v1",
      audience: "github:repository_1",
      occurredAt: "2026-08-28T12:00:00.000Z",
    });
    const publicRegistry = createExternalIssueLinkRegistry(ledger);
    const privateRegistry = createExternalIssueLinkRegistry(ledger);

    expect(
      publicRegistry.request(command({ consentVersion: consent.version })).outbox
        .payload,
    ).toMatchObject({ reporterContent: "The submit button does nothing." });
    expect(
      privateRegistry.request(
        command({
          operationId: "operation_private",
          repository: { ...command().repository, visibility: "private" },
        }),
      ).outbox.payload,
    ).toMatchObject({ reporterContent: "The submit button does nothing." });
  });

  it("BDD-ISSUE-005 denies a second active link but replays the same operation exactly once", () => {
    const registry = createExternalIssueLinkRegistry(createPublicationConsentLedger());
    const first = registry.request(command());

    expect(registry.request(command())).toEqual(first);
    expect(() => registry.request(command({ operationId: "operation_2" }))).toThrow(
      new ExternalIssuePolicyError("ACTIVE_LINK_EXISTS"),
    );
    expect(() => registry.request(command({ reference: "Y7-DIFFERENT" }))).toThrow(
      new ExternalIssuePolicyError("IDEMPOTENCY_CONFLICT"),
    );
  });

  it.each([
    [
      "unassigned Maintainer",
      command({ assignedPrincipalIds: [] }),
      "ISSUE_SCOPE_DENIED",
    ],
    [
      "cross-Project repository",
      command({ repository: { ...command().repository, projectId: "project_2" } }),
      "REPOSITORY_SCOPE_DENIED",
    ],
    [
      "unselected repository",
      command({ repository: { ...command().repository, selected: false } }),
      "REPOSITORY_NOT_SELECTED",
    ],
    [
      "disconnected repository",
      command({
        repository: { ...command().repository, connectionState: "disconnected" },
      }),
      "SOURCE_CONNECTION_INACTIVE",
    ],
  ])("BDD-ISSUE-006 denies %s", (_name, candidate, code) => {
    const registry = createExternalIssueLinkRegistry(createPublicationConsentLedger());
    expect(() => registry.request(candidate)).toThrow(
      new ExternalIssuePolicyError(code),
    );
  });

  it("BDD-ISSUE-007 lets a scoped Workspace Owner link unassigned Feedback", () => {
    const registry = createExternalIssueLinkRegistry(createPublicationConsentLedger());

    expect(
      registry.request(
        command({
          actor: owner,
          assignedPrincipalIds: [],
        }),
      ).link.actorId,
    ).toBe("owner_1");
  });

  it("BDD-ISSUE-008 rejects malformed commands before creating facts", () => {
    for (const candidate of [
      command({ operationId: "" }),
      command({ feedbackId: "" }),
      command({ reference: "" }),
      command({ reporterContent: "" }),
      command({ protectedWorkspaceUrl: "not-a-url" }),
      command({ protectedWorkspaceUrl: "http://y7.example.test/feedback" }),
    ]) {
      expect(() =>
        createExternalIssueLinkRegistry(createPublicationConsentLedger()).request(
          candidate,
        ),
      ).toThrow(new ExternalIssuePolicyError("ISSUE_INPUT_INVALID"));
    }
  });

  it("BDD-ISSUE-009 denies actors outside the authoritative Workspace and Project", () => {
    for (const actor of [
      { ...maintainer, workspaceIds: [] },
      { ...maintainer, projectIds: [] },
      { ...maintainer, responsibility: "platform_operator" as const },
    ]) {
      expect(() =>
        createExternalIssueLinkRegistry(createPublicationConsentLedger()).request(
          command({ actor }),
        ),
      ).toThrow(new ExternalIssuePolicyError("ISSUE_SCOPE_DENIED"));
    }
  });

  it("BDD-ISSUE-010 ignores missing, stale, or wrong-audience consent", () => {
    const ledger = createPublicationConsentLedger();
    const consent = ledger.grant({
      feedbackId: "feedback_1",
      reporterId: "reporter_1",
      disclosureVersion: "public-issue-v1",
      audience: "github:other_repository",
      occurredAt: "2026-08-28T12:00:00.000Z",
    });
    const result = createExternalIssueLinkRegistry(ledger).request(
      command({ consentVersion: consent.version }),
    );

    expect(result.outbox.payload).not.toHaveProperty("reporterContent");
  });
});
