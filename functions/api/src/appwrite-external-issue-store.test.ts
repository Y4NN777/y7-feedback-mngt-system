/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions -- Vitest port doubles intentionally accept SDK-shaped unknown arguments. */
import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import {
  AppwriteExternalIssueError,
  createAppwriteExternalIssueStore,
  type AppwriteExternalIssueTablesPort,
} from "./appwrite-external-issue-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  accessGrantsTableId: "access_grants",
  sourceConnectionsTableId: "source_connections",
  publicationConsentsTableId: "publication_consents",
  externalIssueLinksTableId: "external_issue_links",
  providerOutboxTableId: "provider_outbox",
};

const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  orderAsc: (attribute: string) => `orderAsc:${attribute}`,
  limit: (value: number) => `limit:${String(value)}`,
};

const actor: ActorAccess = {
  principalId: "maintainer_1",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace_1"],
  projectIds: ["project_1"],
};

const baseFeedback = {
  $id: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  reporterId: "reporter_1",
  type: "bug",
  assignedMaintainerId: "maintainer_1",
  currentSourceJson: "sealed-source",
  deletedAt: null,
};

const baseSource = {
  $id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  status: "active",
  selectedRepositoriesJson: JSON.stringify({
    kind: "selected",
    repositories: [{ provider: "github", id: "repository_1" }],
    imports: [
      {
        connectionId: "connection_1",
        provider: "github",
        repositoryId: "repository_1",
        visibility: "public",
      },
    ],
  }),
};

function input() {
  return {
    actor,
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    operationId: "operation_1",
    connectionId: "connection_1",
    repositoryId: "repository_1",
    protectedWorkspaceUrl:
      "https://y7.example.test/w/workspace_1/p/project_1/f/Y7-ABC123",
    consentVersion: undefined,
    payloadDigest: "digest_0123456789abcdef",
    occurredAt: "2026-08-28T13:00:00.000Z",
  } as const;
}

function consentCommand() {
  return {
    feedbackId: "feedback_1",
    reporterId: "reporter_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    operationId: "consent_grant_1",
    payloadDigest: "consent_digest_0123456789",
    disclosureVersion: "public-issue-v1",
    audience: "github:repository_1",
    occurredAt: "2026-08-28T12:00:00.000Z",
  } as const;
}

function setup(
  options: {
    readonly outbox?: readonly unknown[];
    readonly activeLinks?: readonly unknown[];
    readonly consents?: readonly unknown[];
    readonly feedback?: unknown;
    readonly source?: unknown;
    readonly grant?: unknown;
    readonly replayLink?: unknown;
    readonly transactionId?: string;
    readonly failOutboxCreate?: boolean;
    readonly failRollback?: boolean;
    readonly invalidCreateTable?: string;
    readonly openedSource?: string;
  } = {},
) {
  const created: Array<Readonly<Record<string, unknown>>> = [];
  const transactions: Array<Readonly<Record<string, unknown>>> = [];
  const tables: AppwriteExternalIssueTablesPort = {
    createTransaction: vi
      .fn()
      .mockResolvedValue({ $id: options.transactionId ?? "transaction_1" }),
    updateTransaction: vi.fn(async (value) => {
      if (options.failRollback && value.rollback === true) {
        throw new Error("ROLLBACK_FAILED");
      }
      transactions.push(value);
      return {};
    }),
    getRow: vi.fn(async ({ tableId, rowId }) => {
      if (tableId === schema.feedbackTableId && rowId === "feedback_1")
        return options.feedback === undefined ? baseFeedback : options.feedback;
      if (tableId === schema.sourceConnectionsTableId && rowId === "connection_1")
        return options.source === undefined ? baseSource : options.source;
      if (tableId === schema.accessGrantsTableId && rowId === "feedback_1")
        return options.grant === undefined
          ? { feedbackId: "feedback_1", reference: "Y7-ABC123" }
          : options.grant;
      if (tableId === schema.externalIssueLinksTableId && rowId === "link_existing")
        return Object.hasOwn(options, "replayLink")
          ? options.replayLink
          : {
              $id: "link_existing",
              feedbackId: "feedback_1",
              workspaceId: "workspace_1",
              projectId: "project_1",
              state: "active",
              synchronizationState: "pending",
            };
      throw new Error("ROW_NOT_FOUND");
    }),
    listRows: vi.fn(async ({ tableId }) => {
      if (tableId === schema.providerOutboxTableId)
        return { rows: options.outbox ?? [] };
      if (tableId === schema.externalIssueLinksTableId)
        return { rows: options.activeLinks ?? [] };
      if (tableId === schema.publicationConsentsTableId)
        return { rows: options.consents ?? [] };
      throw new Error(`UNEXPECTED_LIST:${tableId}`);
    }),
    createRow: vi.fn(async (value) => {
      if (options.failOutboxCreate && value.tableId === schema.providerOutboxTableId) {
        throw new Error("OUTBOX_CREATE_FAILED");
      }
      if (value.tableId === options.invalidCreateTable) return { $id: "wrong" };
      created.push(value);
      return { $id: value.rowId };
    }),
  };
  const store = createAppwriteExternalIssueStore(
    tables,
    schema,
    {
      environment: "preview",
      protector: {
        seal: vi.fn(),
        open: vi.fn(
          () =>
            options.openedSource ??
            JSON.stringify({ type: "bug", problem: "Submit does not work" }),
        ),
      },
    },
    queries,
  );
  return { store, tables, created, transactions };
}

describe("Appwrite external issue store", () => {
  it("BDD-ISSUE-STORE-001 atomically creates one link and durable minimal outbox", async () => {
    const { store, created, transactions } = setup();

    await expect(store.requestLink(input())).resolves.toMatchObject({
      status: "accepted",
      synchronizationState: "pending",
    });
    expect(created.map((call) => call.tableId)).toEqual([
      schema.externalIssueLinksTableId,
      schema.providerOutboxTableId,
    ]);
    expect(created[1]?.data).toMatchObject({
      status: "pending",
      attempts: 0,
      payloadDigest: "digest_0123456789abcdef",
    });
    expect((created[1]?.data as { payloadJson: string }).payloadJson).not.toContain(
      "Submit does not work",
    );
    expect(transactions).toEqual([{ transactionId: "transaction_1", commit: true }]);
  });

  it("BDD-ISSUE-STORE-002 includes Reporter source only with active exact consent", async () => {
    const { store, created } = setup({
      consents: [
        {
          feedbackId: "feedback_1",
          reporterId: "reporter_1",
          version: 1,
          state: "active",
          disclosureVersion: "public-issue-v1",
          audience: "github:repository_1",
          occurredAt: "2026-08-28T12:00:00.000Z",
        },
      ],
    });

    await store.requestLink({ ...input(), consentVersion: 1 });
    expect((created[1]?.data as { payloadJson: string }).payloadJson).toContain(
      "Submit does not work",
    );
  });

  it("BDD-ISSUE-STORE-002 normalizes Appwrite UTC offsets before rebuilding consent", async () => {
    const { store, created } = setup({
      consents: [
        {
          feedbackId: "feedback_1",
          reporterId: "reporter_1",
          version: 1,
          state: "active",
          disclosureVersion: "public-issue-v1",
          audience: "github:repository_1",
          occurredAt: "2026-08-28T12:00:00.000+00:00",
        },
      ],
    });

    await store.requestLink({ ...input(), consentVersion: 1 });
    expect((created[1]?.data as { payloadJson: string }).payloadJson).toContain(
      "Submit does not work",
    );
  });

  it("BDD-ISSUE-STORE-002 rejects an invalid stored consent timestamp", async () => {
    const { store, created } = setup({
      consents: [
        {
          feedbackId: "feedback_1",
          reporterId: "reporter_1",
          version: 1,
          state: "active",
          disclosureVersion: "public-issue-v1",
          audience: "github:repository_1",
          occurredAt: "invalid",
        },
      ],
    });

    await expect(
      store.requestLink({ ...input(), consentVersion: 1 }),
    ).rejects.toMatchObject({ code: "ERR-ISSUE-RETRYABLE" });
    expect(created).toEqual([]);
  });

  it("BDD-ISSUE-STORE-003 replays an identical operation and rejects key reuse", async () => {
    const prior = {
      operationId: "operation_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      linkId: "link_existing",
      payloadDigest: "digest_0123456789abcdef",
    };
    const replay = setup({ outbox: [prior] });
    await expect(replay.store.requestLink(input())).resolves.toEqual({
      status: "replayed",
      linkId: "link_existing",
      synchronizationState: "pending",
    });
    expect(replay.created).toHaveLength(0);

    const conflict = setup({ outbox: [{ ...prior, payloadDigest: "different" }] });
    await expect(conflict.store.requestLink(input())).rejects.toEqual(
      new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT"),
    );
  });

  it("BDD-ISSUE-STORE-004 denies a second active link", async () => {
    const { store } = setup({ activeLinks: [{ $id: "existing" }] });
    await expect(store.requestLink(input())).rejects.toEqual(
      new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT"),
    );
  });

  it("BDD-ISSUE-STORE-005 rolls back link creation when outbox persistence fails", async () => {
    const { store, transactions } = setup({ failOutboxCreate: true });
    await expect(store.requestLink(input())).rejects.toEqual(
      new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"),
    );
    expect(transactions).toEqual([{ transactionId: "transaction_1", rollback: true }]);
  });

  it("BDD-ISSUE-STORE-006 versions consent atomically and replays its operation", async () => {
    const { store, created } = setup();
    const command = consentCommand();

    await expect(store.grantConsent(command)).resolves.toEqual({
      version: 1,
      state: "active",
    });
    expect(created[0]?.data).toMatchObject({
      version: 1,
      state: "active",
      operationId: "consent_grant_1",
    });
  });

  it("BDD-ISSUE-STORE-007 replays consent and rejects conflicting operation reuse", async () => {
    const fact = {
      ...consentCommand(),
      version: 1,
      state: "active",
    };
    await expect(
      setup({ consents: [fact] }).store.grantConsent(consentCommand()),
    ).resolves.toEqual({ version: 1, state: "active" });
    await expect(
      setup({ consents: [fact] }).store.grantConsent({
        ...consentCommand(),
        payloadDigest: "different_digest_123456",
      }),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-CONFLICT"));
    await expect(
      setup({ consents: [{ ...fact, version: "one" }] }).store.grantConsent(
        consentCommand(),
      ),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));

    const revokedFact = {
      ...fact,
      operationId: "consent_revoke_1",
      payloadDigest: "revoke_digest_0123456789",
      version: 2,
      state: "revoked",
    };
    await expect(
      setup({ consents: [fact, revokedFact] }).store.revokeConsent({
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        operationId: "consent_revoke_1",
        payloadDigest: "revoke_digest_0123456789",
        occurredAt: "2026-08-28T12:05:00.000Z",
      }),
    ).resolves.toEqual({ version: 2, state: "revoked" });
  });

  it("BDD-ISSUE-STORE-008 revokes the latest consent and preserves disclosure facts", async () => {
    const prior = {
      ...consentCommand(),
      operationId: "consent_grant_previous",
      version: 1,
      state: "active",
    };
    const { store, created } = setup({ consents: [prior] });

    await expect(
      store.revokeConsent({
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        operationId: "consent_revoke_1",
        payloadDigest: "revoke_digest_0123456789",
        occurredAt: "2026-08-28T12:05:00.000Z",
      }),
    ).resolves.toEqual({ version: 2, state: "revoked" });
    expect(created[0]?.data).toMatchObject({
      version: 2,
      state: "revoked",
      disclosureVersion: "public-issue-v1",
      audience: "github:repository_1",
    });
  });

  it.each([
    { feedbackId: "bad id" },
    { reporterId: "bad id" },
    { workspaceId: "bad id" },
    { projectId: "bad id" },
    { operationId: "bad id" },
    { payloadDigest: "short" },
    { occurredAt: "invalid" },
  ])("BDD-ISSUE-STORE-009 denies malformed consent %#", async (override) => {
    await expect(
      setup().store.grantConsent({ ...consentCommand(), ...override }),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
  });

  it("BDD-ISSUE-STORE-010 denies consent for a different Reporter", async () => {
    await expect(
      setup().store.grantConsent({
        ...consentCommand(),
        reporterId: "reporter_2",
      }),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
    await expect(
      setup().store.grantConsent({
        ...consentCommand(),
        disclosureVersion: undefined as never,
        audience: undefined as never,
      }),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
  });

  it("BDD-ISSUE-STORE-011 validates schema and transaction identity", async () => {
    expect(() =>
      createAppwriteExternalIssueStore(
        setup().tables,
        { ...schema, providerOutboxTableId: "bad id" },
        {
          environment: "preview",
          protector: { seal: vi.fn(), open: vi.fn() },
        },
        queries,
      ),
    ).toThrow("APPWRITE_EXTERNAL_ISSUE_SCHEMA_INVALID");
    expect(() =>
      createAppwriteExternalIssueStore(
        setup().tables,
        { ...schema, providerOutboxTableId: schema.externalIssueLinksTableId },
        {
          environment: "preview",
          protector: { seal: vi.fn(), open: vi.fn() },
        },
        queries,
      ),
    ).toThrow("APPWRITE_EXTERNAL_ISSUE_SCHEMA_INVALID");
    await expect(
      setup({ transactionId: "bad id" }).store.requestLink(input()),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
  });

  it.each([
    { feedbackId: "bad id" },
    { workspaceId: "bad id" },
    { projectId: "bad id" },
    { operationId: "bad id" },
    { connectionId: "bad id" },
    { repositoryId: "bad id" },
    { payloadDigest: "short" },
    { occurredAt: "invalid" },
  ])("BDD-ISSUE-STORE-012 denies malformed link request %#", async (override) => {
    await expect(
      setup().store.requestLink({ ...input(), ...override }),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
  });

  it("BDD-ISSUE-STORE-013 denies corrupt or cross-scope Feedback rows", async () => {
    for (const candidate of [
      null,
      { ...baseFeedback, $id: "other" },
      { ...baseFeedback, workspaceId: "other" },
      { ...baseFeedback, projectId: "other" },
      { ...baseFeedback, deletedAt: "2026-08-28T00:00:00.000Z" },
      { ...baseFeedback, reporterId: 1 },
      { ...baseFeedback, reporterId: "bad id" },
      { ...baseFeedback, type: "other" },
    ]) {
      await expect(
        setup({ feedback: candidate }).store.requestLink(input()),
      ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
    }
  });

  it("BDD-ISSUE-STORE-014 fails closed for corrupt source envelopes", async () => {
    for (const options of [
      { feedback: { ...baseFeedback, currentSourceJson: 1 } },
      { openedSource: "not-json" },
      { openedSource: JSON.stringify([]) },
      {
        openedSource: JSON.stringify({
          type: "review",
          experience: "x",
          appreciation: "y",
        }),
      },
      { openedSource: JSON.stringify({ type: "bug", problem: "" }) },
    ]) {
      await expect(setup(options).store.requestLink(input())).rejects.toEqual(
        new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"),
      );
    }
  });

  it("BDD-ISSUE-STORE-015 denies inactive, unselected, or cross-scope repositories", async () => {
    for (const candidate of [
      null,
      { ...baseSource, $id: "other" },
      { ...baseSource, workspaceId: "other" },
      { ...baseSource, projectId: "other" },
      { ...baseSource, status: "disconnected" },
      { ...baseSource, selectedRepositoriesJson: 1 },
      {
        ...baseSource,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [{ provider: "github", id: "other" }],
          imports: [],
        }),
      },
      {
        ...baseSource,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [{ provider: "github", id: "repository_1" }],
          imports: [
            {
              connectionId: "connection_1",
              provider: "github",
              repositoryId: "repository_1",
              visibility: "secret",
            },
          ],
        }),
      },
    ]) {
      await expect(
        setup({ source: candidate }).store.requestLink(input()),
      ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
    }
  });

  it("BDD-ISSUE-STORE-016 rejects corrupt repository projections", async () => {
    for (const selectedRepositoriesJson of [
      "not-json",
      JSON.stringify([]),
      JSON.stringify({ kind: "authorized", repositories: [], imports: [] }),
      JSON.stringify({ kind: "selected", repositories: {}, imports: [] }),
      JSON.stringify({ kind: "selected", repositories: [], imports: {} }),
    ]) {
      await expect(
        setup({
          source: { ...baseSource, selectedRepositoriesJson },
        }).store.requestLink(input()),
      ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    }
    await expect(
      setup({ source: { ...baseSource, provider: "bitbucket" } }).store.requestLink(
        input(),
      ),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
  });

  it("BDD-ISSUE-STORE-017 treats private and internal repositories as non-public", async () => {
    for (const visibility of ["private", "internal"] as const) {
      const selected = JSON.parse(baseSource.selectedRepositoriesJson) as {
        imports: Array<Record<string, unknown>>;
      };
      selected.imports[0] = { ...selected.imports[0], visibility };
      const { store, created } = setup({
        source: { ...baseSource, selectedRepositoriesJson: JSON.stringify(selected) },
      });
      await store.requestLink(input());
      expect((created[1]?.data as { payloadJson: string }).payloadJson).toContain(
        "Submit does not work",
      );
    }
  });

  it("BDD-ISSUE-STORE-018 rejects malformed consent history", async () => {
    const valid = {
      ...consentCommand(),
      operationId: "previous",
      version: 1,
      state: "active",
    };
    for (const candidate of [
      null,
      { ...valid, feedbackId: "other" },
      { ...valid, version: 2 },
      { ...valid, reporterId: 1 },
      { ...valid, disclosureVersion: 1 },
      { ...valid, audience: 1 },
      { ...valid, occurredAt: 1 },
      { ...valid, state: "other" },
    ]) {
      await expect(
        setup({ consents: [candidate] }).store.requestLink(input()),
      ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    }
  });

  it("BDD-ISSUE-STORE-019 handles duplicate outbox and corrupt replay links", async () => {
    await expect(
      setup({ outbox: [{}, {}] }).store.requestLink(input()),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    const prior = {
      operationId: "operation_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      linkId: "link_existing",
      payloadDigest: "digest_0123456789abcdef",
    };
    for (const replayLink of [
      null,
      { feedbackId: "other", synchronizationState: "pending" },
      { feedbackId: "feedback_1", synchronizationState: "unknown" },
    ]) {
      await expect(
        setup({ outbox: [prior], replayLink }).store.requestLink(input()),
      ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    }
    for (const synchronizationState of ["failed", "synchronized"] as const) {
      await expect(
        setup({
          outbox: [prior],
          replayLink: { feedbackId: "feedback_1", synchronizationState },
        }).store.requestLink(input()),
      ).resolves.toMatchObject({ status: "replayed", synchronizationState });
    }
  });

  it("BDD-ISSUE-STORE-020 rejects missing or corrupt authoritative access grants", async () => {
    for (const grant of [
      null,
      {},
      { feedbackId: "other", reference: "Y7-ABC123" },
      { feedbackId: "feedback_1", reference: "bad ref!" },
    ]) {
      await expect(setup({ grant }).store.requestLink(input())).rejects.toEqual(
        new AppwriteExternalIssueError("ERR-ISSUE-DENIED"),
      );
    }
  });

  it("BDD-ISSUE-STORE-021 validates created row identities and preserves rollback failure", async () => {
    await expect(
      setup({ invalidCreateTable: schema.externalIssueLinksTableId }).store.requestLink(
        input(),
      ),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    await expect(
      setup({ invalidCreateTable: schema.providerOutboxTableId }).store.requestLink(
        input(),
      ),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    await expect(
      setup({ failOutboxCreate: true, failRollback: true }).store.requestLink(input()),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
    await expect(
      setup({
        invalidCreateTable: schema.publicationConsentsTableId,
      }).store.grantConsent(consentCommand()),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-RETRYABLE"));
  });

  it("BDD-ISSUE-STORE-022 denies an unassigned Maintainer through domain policy", async () => {
    await expect(
      setup({
        feedback: { ...baseFeedback, assignedMaintainerId: null },
      }).store.requestLink(input()),
    ).rejects.toEqual(new AppwriteExternalIssueError("ERR-ISSUE-DENIED"));
  });

  it("BDD-ISSUE-STORE-023 rebuilds revoked consent without publishing Reporter content", async () => {
    const grant = {
      ...consentCommand(),
      operationId: "grant_previous",
      version: 1,
      state: "active",
    };
    const revoke = {
      ...grant,
      operationId: "revoke_previous",
      payloadDigest: "revoke_previous_digest",
      version: 2,
      state: "revoked",
      occurredAt: "2026-08-28T12:05:00.000Z",
    };
    const { store, created } = setup({ consents: [grant, revoke] });
    await store.requestLink({ ...input(), consentVersion: 2 });
    expect((created[1]?.data as { payloadJson: string }).payloadJson).not.toContain(
      "Submit does not work",
    );
  });
});
