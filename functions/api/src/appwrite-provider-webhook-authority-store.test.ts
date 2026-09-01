import { describe, expect, it, vi } from "vitest";

import { createAppwriteProviderWebhookAuthorityStore } from "./appwrite-provider-webhook-authority-store.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

const schema = {
  databaseId: "feedback",
  sourceConnectionsTableId: "source_connections",
  providerGrantsTableId: "provider_grants",
};
const persistence = {
  environment: "preview",
  protector: createSensitiveDataProtector(
    "key-1",
    [{ id: "key-1", material: Buffer.alloc(32, 5) }],
    () => Buffer.alloc(12, 6),
  ),
};
const githubCredential = {
  kind: "github_hmac" as const,
  secret: "github-webhook-secret-with-at-least-32-bytes",
};

function sealed(value: unknown): string {
  return persistence.protector.seal(
    {
      environment: "preview",
      tableId: "provider_grants",
      rowId: "grant_1",
      field: "webhookCredentialEnvelope",
    },
    JSON.stringify(value),
  );
}

function connection(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "connection_1",
    provider: "github",
    status: "active",
    workspaceId: "workspace_1",
    projectId: "project_1",
    encryptedGrantRef: "grant_1",
    selectedRepositoriesJson: JSON.stringify({
      kind: "selected",
      imports: [
        {
          connectionId: "connection_1",
          provider: "github",
          repositoryId: "1329343404",
        },
      ],
    }),
    ...overrides,
  };
}

function harness(
  overrides: {
    readonly connection?: unknown;
    readonly grant?: unknown;
    readonly updated?: unknown;
  } = {},
) {
  interface UpdateInput {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }
  const getRow = vi.fn((input: { readonly tableId: string }) =>
    Promise.resolve(
      input.tableId === "source_connections"
        ? overrides.connection === undefined
          ? connection()
          : overrides.connection
        : overrides.grant === undefined
          ? {
              $id: "grant_1",
              provider: "github",
              webhookCredentialEnvelope: sealed(githubCredential),
            }
          : overrides.grant,
    ),
  );
  const updateRow = vi.fn((input: UpdateInput) => {
    void input;
    return Promise.resolve(overrides.updated ?? { $id: "grant_1" });
  });
  const store = createAppwriteProviderWebhookAuthorityStore(
    { getRow, updateRow },
    schema,
    persistence,
  );
  return { store, getRow, updateRow };
}

describe("Appwrite provider webhook authority store", () => {
  it("BDD-SYNC-023 resolves an active exact-scope repository and encrypted credential", async () => {
    const { store, getRow } = harness();
    await expect(
      store.resolve({ provider: "github", connectionId: "connection_1" }),
    ).resolves.toEqual({
      connectionId: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      repositoryId: "1329343404",
      credential: githubCredential,
      active: true,
    });
    expect(getRow).toHaveBeenCalledTimes(2);
  });

  it("BDD-SYNC-024 encrypts a credential alongside its matching provider grant", async () => {
    const { store, updateRow } = harness();
    await expect(
      store.save({
        provider: "github",
        encryptedGrantRef: "grant_1",
        credential: githubCredential,
      }),
    ).resolves.toBeUndefined();
    const update = updateRow.mock.calls[0]?.[0];
    expect(update).toMatchObject({
      databaseId: "feedback",
      tableId: "provider_grants",
      rowId: "grant_1",
    });
    expect(JSON.stringify(update)).not.toContain(githubCredential.secret);
    const envelope = update?.data.webhookCredentialEnvelope;
    expect(typeof envelope).toBe("string");
    expect(
      JSON.parse(
        persistence.protector.open(
          {
            environment: "preview",
            tableId: "provider_grants",
            rowId: "grant_1",
            field: "webhookCredentialEnvelope",
          },
          String(envelope),
        ),
      ),
    ).toEqual(githubCredential);
  });

  it.each([
    null,
    connection({ status: "disconnected" }),
    connection({ provider: "gitlab" }),
    connection({ workspaceId: "bad/id" }),
    connection({ selectedRepositoriesJson: "invalid" }),
    connection({
      selectedRepositoriesJson: JSON.stringify({ kind: "selected", imports: [] }),
    }),
  ])(
    "BDD-SYNC-025 denies inactive, malformed or unselected authority %#",
    async (value) => {
      const { store } = harness({ connection: value });
      await expect(
        store.resolve({ provider: "github", connectionId: "connection_1" }),
      ).resolves.toBeNull();
    },
  );

  it("BDD-SYNC-026 rejects corrupt, cross-provider and malformed credentials", async () => {
    const absent = harness({ grant: null });
    await expect(
      absent.store.resolve({ provider: "github", connectionId: "connection_1" }),
    ).resolves.toBeNull();

    const corrupt = harness({
      grant: {
        $id: "grant_1",
        provider: "github",
        webhookCredentialEnvelope: "corrupt",
      },
    });
    await expect(
      corrupt.store.resolve({ provider: "github", connectionId: "connection_1" }),
    ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");

    const wrongKind = harness({
      grant: {
        $id: "grant_1",
        provider: "github",
        webhookCredentialEnvelope: sealed({
          kind: "gitlab_legacy",
          secret: "gitlab-webhook-secret-with-at-least-32-bytes",
        }),
      },
    });
    await expect(
      wrongKind.store.resolve({ provider: "github", connectionId: "connection_1" }),
    ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
  });

  it("BDD-SYNC-027 supports GitLab HMAC and bounded legacy credential formats", async () => {
    const signingToken = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
    for (const credential of [
      { kind: "gitlab_hmac" as const, signingToken },
      {
        kind: "gitlab_legacy" as const,
        secret: "gitlab-webhook-secret-with-at-least-32-bytes",
      },
    ]) {
      const tables = {
        getRow: vi.fn(() => Promise.resolve({ $id: "grant_1", provider: "gitlab" })),
        updateRow: vi.fn(() => Promise.resolve({ $id: "grant_1" })),
      };
      const store = createAppwriteProviderWebhookAuthorityStore(
        tables,
        schema,
        persistence,
      );
      await expect(
        store.save({ provider: "gitlab", encryptedGrantRef: "grant_1", credential }),
      ).resolves.toBeUndefined();
    }
  });

  it("BDD-SYNC-028 validates schema, identifiers and write identity", async () => {
    const { getRow, updateRow } = harness();
    expect(() =>
      createAppwriteProviderWebhookAuthorityStore(
        { getRow, updateRow },
        { ...schema, providerGrantsTableId: "feedback" },
        persistence,
      ),
    ).toThrow("PROVIDER_WEBHOOK_AUTHORITY_SCHEMA_INVALID");
    const { store } = harness({ updated: { $id: "other" } });
    await expect(
      store.save({
        provider: "github",
        encryptedGrantRef: "bad/id",
        credential: githubCredential,
      }),
    ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
    await expect(
      store.save({
        provider: "github",
        encryptedGrantRef: "grant_1",
        credential: githubCredential,
      }),
    ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_WRITE_INVALID");
  });

  it("BDD-SYNC-032 fails closed on malformed selections and coordinates", async () => {
    for (const selectedRepositoriesJson of [
      undefined,
      JSON.stringify(null),
      JSON.stringify({ kind: "other", imports: [] }),
      JSON.stringify({ kind: "selected", imports: null }),
    ]) {
      const { store } = harness({
        connection: connection({ selectedRepositoriesJson }),
      });
      await expect(
        store.resolve({ provider: "github", connectionId: "connection_1" }),
      ).resolves.toBeNull();
    }
    const { store } = harness();
    await expect(
      store.resolve({ provider: "github", connectionId: "bad/id" }),
    ).resolves.toBeNull();
  });

  it("BDD-SYNC-033 rejects non-object credentials and mismatched grant writes", async () => {
    const { store } = harness();
    await expect(
      store.save({
        provider: "github",
        encryptedGrantRef: "grant_1",
        credential: null as never,
      }),
    ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");

    for (const grant of [null, { $id: "other", provider: "github" }]) {
      const invalid = harness({ grant });
      await expect(
        invalid.store.save({
          provider: "github",
          encryptedGrantRef: "grant_1",
          credential: githubCredential,
        }),
      ).rejects.toThrow("PROVIDER_WEBHOOK_CREDENTIAL_INVALID");
    }
  });
});
