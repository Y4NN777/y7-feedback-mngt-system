import { expect, it } from "vitest";

import { createAppwriteProviderMessageStore } from "./appwrite-provider-message-store";
import type { ProviderMessageObservation } from "./provider-message-event";

const schema = {
  databaseId: "feedback",
  sourceConnectionsTableId: "source_connections",
  externalIssueLinksTableId: "external_issue_links",
  conversationMessagesTableId: "conversation_messages",
};

const observation: ProviderMessageObservation = {
  provider: "github",
  deliveryId: "delivery_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "repo_1",
  issueId: "issue_1",
  commentId: "comment_1",
  authorId: "author_1",
  authorLogin: "maintainer",
  mutation: "created",
  content: "Visible answer",
  providerUpdatedAt: "2026-09-02T01:00:00.000Z",
};

class FakeTables {
  readonly created: Array<Readonly<Record<string, unknown>>> = [];
  readonly rows = new Map<string, unknown>();
  messages: readonly unknown[] = [];
  links: readonly unknown[] = [
    {
      $id: "link_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      connectionId: "connection_1",
      provider: "github",
      repositoryId: "repo_1",
      providerIssueId: "issue_1",
      state: "active",
    },
  ];

  constructor() {
    this.rows.set("source_connections:connection_1", {
      $id: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      status: "active",
      encryptedGrantRef: "grant_1",
      selectedRepositoriesJson: JSON.stringify({
        kind: "selected",
        imports: [
          {
            connectionId: "connection_1",
            provider: "github",
            repositoryId: "repo_1",
            owner: "owner",
            name: "repo",
          },
        ],
      }),
    });
    this.rows.set("external_issue_links:link_1", this.links[0]);
  }

  createTransaction() {
    return Promise.resolve({ $id: "transaction_1" });
  }
  updateTransaction() {
    return Promise.resolve({});
  }
  getRow(input: { readonly tableId: string; readonly rowId: string }) {
    const value = this.rows.get(`${input.tableId}:${input.rowId}`);
    return value === undefined
      ? Promise.reject(new Error("missing"))
      : Promise.resolve(value);
  }
  listRows(input: { readonly tableId: string }) {
    return Promise.resolve({
      rows:
        input.tableId === schema.externalIssueLinksTableId
          ? this.links
          : input.tableId === schema.conversationMessagesTableId
            ? this.messages
            : [],
    });
  }
  createRow(input: Readonly<Record<string, unknown>>) {
    this.created.push(input);
    return Promise.resolve({ $id: input.rowId });
  }
}

function target(tables = new FakeTables()) {
  return {
    tables,
    store: createAppwriteProviderMessageStore(
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

it("BDD-SYNC-STORE-001 resolves only an active scoped issue and selected repository", async () => {
  const { store } = target();
  await expect(store.resolve(observation)).resolves.toEqual({
    status: "resolved",
    context: {
      ...observation,
      linkId: "link_1",
      feedbackId: "feedback_1",
      encryptedGrantRef: "grant_1",
      repositoryOwner: "owner",
      repositoryName: "repo",
    },
  });
});

it("BDD-SYNC-STORE-002 appends an encrypted attributable provider Message", async () => {
  const { store, tables } = target();
  const resolved = await store.resolve(observation);
  if (resolved.status !== "resolved") throw new Error("fixture");
  await expect(store.apply(resolved.context)).resolves.toBe("applied");
  expect(tables.created).toHaveLength(1);
  expect(tables.created[0]).toMatchObject({
    tableId: "conversation_messages",
    permissions: [],
    data: {
      feedbackId: "feedback_1",
      actorKind: "workspace",
      audience: "reporter",
      origin: "provider",
      providerLinkId: "link_1",
      provider: "github",
      providerCommentId: "comment_1",
      providerEventId: "delivery_1",
      revisionKind: "created",
      contentEnvelope: "sealed:contentEnvelope:Visible answer",
      providerAuthorEnvelope:
        'sealed:providerAuthorEnvelope:{"id":"author_1","login":"maintainer"}',
    },
  });
});

it("BDD-SYNC-STORE-003 appends revisions and tombstones without overwriting history", async () => {
  const first = {
    $id: "pmsg_previous",
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    origin: "provider",
    provider: "github",
    repositoryId: "repo_1",
    providerIssueId: "issue_1",
    providerCommentId: "comment_1",
    providerUpdatedAt: "2026-09-02T01:00:00.000Z",
  };
  const revisionTarget = target();
  revisionTarget.tables.messages = [first];
  const resolved = await revisionTarget.store.resolve({
    ...observation,
    mutation: "revised",
    content: "Corrected answer",
    deliveryId: "delivery_2",
    providerUpdatedAt: "2026-09-02T01:01:00.000Z",
  });
  if (resolved.status !== "resolved") throw new Error("fixture");
  await revisionTarget.store.apply(resolved.context);
  expect(revisionTarget.tables.created[0]).toMatchObject({
    data: { revisionKind: "revised", supersedesMessageId: "pmsg_previous" },
  });

  const tombstoneTarget = target();
  tombstoneTarget.tables.messages = [first];
  const deleted = await tombstoneTarget.store.resolve({
    ...observation,
    mutation: "tombstoned",
    content: undefined,
    deliveryId: "delivery_3",
    providerUpdatedAt: "2026-09-02T01:02:00.000Z",
  });
  if (deleted.status !== "resolved") throw new Error("fixture");
  await tombstoneTarget.store.apply(deleted.context);
  expect(tombstoneTarget.tables.created[0]).toMatchObject({
    data: {
      revisionKind: "tombstoned",
      supersedesMessageId: "pmsg_previous",
      contentEnvelope: "sealed:contentEnvelope:External message deleted.",
    },
  });
});

it("BDD-SYNC-STORE-004 ignores duplicate, delayed and reordered comment facts", async () => {
  const { store, tables } = target();
  tables.messages = [
    {
      $id: "pmsg_latest",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      origin: "provider",
      provider: "github",
      repositoryId: "repo_1",
      providerIssueId: "issue_1",
      providerCommentId: "comment_1",
      providerEventId: "delivery_newer",
      providerUpdatedAt: "2026-09-02T02:00:00.000Z",
    },
  ];
  const resolved = await store.resolve(observation);
  if (resolved.status !== "resolved") throw new Error("fixture");
  await expect(store.apply(resolved.context)).resolves.toBe("ignored");
  expect(tables.created).toHaveLength(0);
});

it.each([
  ["missing link", []],
  [
    "ambiguous link",
    [
      {
        $id: "link_1",
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
        provider: "github",
        repositoryId: "repo_1",
        providerIssueId: "issue_1",
        state: "active",
      },
      {
        $id: "link_2",
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
        provider: "github",
        repositoryId: "repo_1",
        providerIssueId: "issue_1",
        state: "active",
      },
    ],
  ],
] as const)("BDD-SYNC-STORE-005 fails closed for %s", async (_label, links) => {
  const tables = new FakeTables();
  tables.links = links;
  const result = await target(tables).store.resolve(observation);
  expect(result.status).not.toBe("resolved");
});
