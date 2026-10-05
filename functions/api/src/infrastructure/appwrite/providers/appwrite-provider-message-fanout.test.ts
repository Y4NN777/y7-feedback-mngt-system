import { expect, it, vi } from "vitest";

import { createAppwriteProviderMessageFanout } from "./appwrite-provider-message-fanout";

const schema = {
  databaseId: "feedback",
  externalIssueLinksTableId: "external_issue_links",
  publicationConsentsTableId: "publication_consents",
  providerSyncOutboxTableId: "provider_sync_outbox",
};

class FakeTables {
  readonly created: Array<Readonly<Record<string, unknown>>> = [];
  links: readonly unknown[] = [
    {
      $id: "link_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      connectionId: "connection_1",
      provider: "github",
      repositoryId: "repo_1",
      visibility: "private",
      providerIssueId: "issue_1",
      state: "active",
    },
  ];
  consents: readonly unknown[] = [];
  outbox: readonly unknown[] = [];
  listRows(input: { readonly tableId: string }) {
    return Promise.resolve({
      rows:
        input.tableId === schema.externalIssueLinksTableId
          ? this.links
          : input.tableId === schema.publicationConsentsTableId
            ? this.consents
            : this.outbox,
    });
  }
  createRow(input: Readonly<Record<string, unknown>>) {
    this.created.push(input);
    return Promise.resolve({ $id: input.rowId });
  }
}

const input = {
  transactionId: "transaction_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  messageId: "message_1",
  actorKind: "reporter" as const,
  audience: "reporter" as const,
  content: "Reporter-visible answer",
  occurredAt: "2026-09-02T02:00:00.000Z",
};

function target(tables = new FakeTables()) {
  return {
    tables,
    fanout: createAppwriteProviderMessageFanout(
      tables,
      schema,
      {
        equal: (key, values) => `${key}=${values.join(",")}`,
        orderDesc: (key) => `-${key}`,
        limit: (value) => `limit=${String(value)}`,
      },
      {
        environment: "preview",
        protector: {
          seal: (context, value) => `sealed:${context.field}:${value}`,
          open: () => "unused",
        },
      },
    ),
  };
}

it("BDD-SYNC-FANOUT-001 queues a private-repository visible Message atomically", async () => {
  const { fanout, tables } = target();
  await expect(fanout.append(input)).resolves.toEqual({ queued: 1 });
  expect(tables.created).toHaveLength(1);
  expect(tables.created[0]).toMatchObject({
    tableId: "provider_sync_outbox",
    transactionId: "transaction_1",
    permissions: [],
    data: {
      feedbackId: "feedback_1",
      linkId: "link_1",
      provider: "github",
      repositoryId: "repo_1",
      kind: "publish_message",
      status: "pending",
      sequence: 1,
      attempts: 0,
      originMarker: "y7msg:message_1",
    },
  });
  const payload = String(
    (tables.created[0]?.data as Readonly<Record<string, unknown>>).payloadEnvelope,
  );
  expect(payload).toContain("Reporter-visible answer");
  expect(payload).not.toMatch(/proof|contact|attachment|internal.note/i);
});

it("BDD-SYNC-FANOUT-002 blocks Reporter content to a public repository without active exact consent", async () => {
  const tables = new FakeTables();
  tables.links = [{ ...(tables.links[0] as object), visibility: "public" }];
  await expect(target(tables).fanout.append(input)).resolves.toEqual({ queued: 0 });
  expect(tables.created).toHaveLength(0);
});

it("BDD-SYNC-FANOUT-003 publishes Reporter content only with active Feedback-specific audience consent", async () => {
  const tables = new FakeTables();
  tables.links = [{ ...(tables.links[0] as object), visibility: "public" }];
  tables.consents = [
    {
      feedbackId: "feedback_1",
      version: 1,
      state: "active",
      audience: "github:repo_1",
      occurredAt: "2026-09-02T01:00:00.000Z",
    },
  ];
  await expect(target(tables).fanout.append(input)).resolves.toEqual({ queued: 1 });
});

it("BDD-SYNC-FANOUT-004 allows a maintainer-visible reply without expanding Reporter consent", async () => {
  const tables = new FakeTables();
  tables.links = [{ ...(tables.links[0] as object), visibility: "public" }];
  await expect(
    target(tables).fanout.append({ ...input, actorKind: "workspace" }),
  ).resolves.toEqual({ queued: 1 });
});

it("BDD-SYNC-FANOUT-005 never queues Workspace-only Messages or Internal Notes", async () => {
  const { fanout, tables } = target();
  await expect(fanout.append({ ...input, audience: "workspace" })).resolves.toEqual({
    queued: 0,
  });
  expect(tables.created).toHaveLength(0);
});

it("BDD-SYNC-FANOUT-006 increments a per-link sequence and denies malformed history", async () => {
  const tables = new FakeTables();
  tables.outbox = [{ linkId: "link_1", sequence: 8 }];
  await target(tables).fanout.append(input);
  expect(tables.created[0]).toMatchObject({ data: { sequence: 9 } });

  const malformed = new FakeTables();
  malformed.outbox = [{ linkId: "link_1", sequence: "8" }];
  await expect(target(malformed).fanout.append(input)).rejects.toThrow(
    "PROVIDER_MESSAGE_FANOUT_STATE_INVALID",
  );
});

it("fails closed for every malformed schema, command and authoritative link field", async () => {
  for (const invalidSchema of [
    { ...schema, databaseId: "bad/id" },
    { ...schema, providerSyncOutboxTableId: schema.externalIssueLinksTableId },
  ]) {
    expect(() =>
      createAppwriteProviderMessageFanout(
        new FakeTables(),
        invalidSchema,
        { equal: vi.fn(), orderDesc: vi.fn(), limit: vi.fn() },
        {
          environment: "preview",
          protector: { seal: vi.fn(), open: vi.fn() },
        },
      ),
    ).toThrow("PROVIDER_MESSAGE_FANOUT_SCHEMA_INVALID");
  }

  for (const mutation of [
    { transactionId: "bad/id" },
    { feedbackId: "bad/id" },
    { workspaceId: "bad/id" },
    { projectId: "bad/id" },
    { messageId: "bad/id" },
    { content: "" },
    { content: "x".repeat(10_001) },
    { occurredAt: "invalid" },
  ]) {
    await expect(target().fanout.append({ ...input, ...mutation })).rejects.toThrow(
      "PROVIDER_MESSAGE_FANOUT_INPUT_INVALID",
    );
  }

  const validLink = new FakeTables().links[0] as Readonly<Record<string, unknown>>;
  for (const mutation of [
    { $id: null },
    { $id: "bad/id" },
    { feedbackId: "other" },
    { workspaceId: "other" },
    { projectId: "other" },
    { connectionId: null },
    { connectionId: "bad/id" },
    { provider: "other" },
    { repositoryId: null },
    { repositoryId: "" },
    { repositoryId: "x".repeat(101) },
    { providerIssueId: null },
    { providerIssueId: "" },
    { providerIssueId: "x".repeat(101) },
    { visibility: "unknown" },
  ]) {
    const tables = new FakeTables();
    tables.links = [{ ...validLink, ...mutation }];
    await expect(target(tables).fanout.append(input)).rejects.toThrow(
      "PROVIDER_MESSAGE_FANOUT_STATE_INVALID",
    );
  }
  const multiple = new FakeTables();
  multiple.links = [validLink, validLink];
  await expect(target(multiple).fanout.append(input)).rejects.toThrow(
    "PROVIDER_MESSAGE_FANOUT_STATE_INVALID",
  );
});

it("fails closed for malformed consent, prior state and write acknowledgement", async () => {
  const publicTables = () => {
    const tables = new FakeTables();
    tables.links = [{ ...(tables.links[0] as object), visibility: "public" }];
    return tables;
  };
  const consent = {
    feedbackId: "feedback_1",
    version: 1,
    state: "active",
    audience: "github:repo_1",
  };
  for (const rows of [
    [consent, consent],
    [null],
    [{ ...consent, feedbackId: "other" }],
    [{ ...consent, state: "revoked" }],
    [{ ...consent, audience: "github:other" }],
    [{ ...consent, version: "1" }],
    [{ ...consent, version: 1.5 }],
  ]) {
    const tables = publicTables();
    tables.consents = rows;
    await expect(target(tables).fanout.append(input)).resolves.toEqual({ queued: 0 });
  }

  for (const row of [
    null,
    { linkId: "other", sequence: 1 },
    { linkId: "link_1", sequence: 0 },
  ]) {
    const tables = new FakeTables();
    tables.outbox = [row];
    await expect(target(tables).fanout.append(input)).rejects.toThrow(
      "PROVIDER_MESSAGE_FANOUT_STATE_INVALID",
    );
  }

  const tables = new FakeTables();
  tables.createRow = () => Promise.resolve({ $id: "wrong" });
  await expect(target(tables).fanout.append(input)).rejects.toThrow(
    "PROVIDER_MESSAGE_FANOUT_WRITE_INVALID",
  );
});
