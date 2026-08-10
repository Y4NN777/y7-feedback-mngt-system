import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteProviderGrantVault,
  createNodeAppwriteProviderGrantVault,
  type AppwriteProviderGrantTablesPort,
} from "./appwrite-provider-grant-vault";

const schema = { databaseId: "feedback", providerGrantsTableId: "provider_grants" };
const key = Buffer.alloc(32, 7);
const nonce = Buffer.alloc(12, 3);
const material = {
  accessToken: "provider-access-secret",
  refreshToken: "provider-refresh-secret",
  expiresAt: "2026-08-10T18:00:00.000Z",
};

function setup(row?: unknown) {
  const createRow = vi.fn(
    (input: Parameters<AppwriteProviderGrantTablesPort["createRow"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const getRow = vi.fn(() => Promise.resolve(row));
  const deleteRow = vi.fn(() => Promise.resolve());
  const tables: AppwriteProviderGrantTablesPort = { createRow, getRow, deleteRow };
  return {
    createRow,
    deleteRow,
    getRow,
    vault: createAppwriteProviderGrantVault(tables, schema, key, {
      createReference: () => "grant_1",
      createNonce: () => nonce,
    }),
  };
}

describe("private Appwrite provider grant vault", () => {
  it("BDD-SRC-VAULT-001 stores only an authenticated encrypted grant envelope", async () => {
    const current = setup();

    await expect(current.vault.seal("github", material)).resolves.toBe("grant_1");

    const created = current.createRow.mock.calls[0]?.[0];
    expect(created).toEqual({
      databaseId: "feedback",
      tableId: "provider_grants",
      rowId: "grant_1",
      data: {
        provider: "github",
        envelope: created?.data.envelope,
      },
      permissions: [],
    });
    expect(created?.data.envelope).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(JSON.stringify(created)).not.toContain(material.accessToken);
    expect(JSON.stringify(created)).not.toContain(material.refreshToken);
  });

  it("opens the exact provider-bound grant and deletes only after provider validation", async () => {
    const sealed = setup();
    await sealed.vault.seal("gitlab", material);
    const envelope = sealed.createRow.mock.calls[0]?.[0].data.envelope;
    const stored = { $id: "grant_1", provider: "gitlab", envelope };
    const current = setup(stored);

    await expect(current.vault.open("gitlab", "grant_1")).resolves.toEqual(material);
    await current.vault.remove("gitlab", "grant_1");

    expect(current.getRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "provider_grants",
      rowId: "grant_1",
    });
    expect(current.deleteRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "provider_grants",
      rowId: "grant_1",
    });
  });

  it("supports access-only grants without inventing refresh or expiry fields", async () => {
    const accessOnly = { accessToken: "access-only-secret" };
    const sealed = setup();
    await sealed.vault.seal("github", accessOnly);
    const envelope = sealed.createRow.mock.calls[0]?.[0].data.envelope;
    const current = setup({ $id: "grant_1", provider: "github", envelope });

    await expect(current.vault.open("github", "grant_1")).resolves.toEqual(accessOnly);
  });

  it("fails closed for cross-provider, altered, malformed, and invalid material", async () => {
    const sealed = setup();
    await sealed.vault.seal("github", material);
    const envelope = String(sealed.createRow.mock.calls[0]?.[0].data.envelope);
    const altered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;

    for (const row of [
      { $id: "grant_1", provider: "gitlab", envelope },
      { $id: "grant_1", provider: "github", envelope: altered },
      { $id: "grant_1", provider: "github", envelope: "invalid" },
      null,
    ]) {
      await expect(setup(row).vault.open("github", "grant_1")).rejects.toThrow(
        "APPWRITE_PROVIDER_GRANT_INVALID",
      );
    }

    const current = setup({ $id: "grant_1", provider: "gitlab", envelope });
    await expect(current.vault.remove("github", "grant_1")).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_INVALID",
    );
    expect(current.deleteRow).not.toHaveBeenCalled();

    for (const invalid of [
      { accessToken: "" },
      { accessToken: "token", refreshToken: "" },
      { accessToken: "token", expiresAt: "not-a-date" },
      { accessToken: 7 },
      { accessToken: "token", unexpected: "field" },
      null,
    ]) {
      await expect(sealed.vault.seal("github", invalid as never)).rejects.toThrow(
        "APPWRITE_PROVIDER_GRANT_INVALID",
      );
    }
    const invalidProvider = "bitbucket" as never;
    await expect(sealed.vault.seal(invalidProvider, material)).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_INVALID",
    );
    await expect(sealed.vault.open(invalidProvider, "grant_1")).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_INVALID",
    );
    await expect(sealed.vault.remove(invalidProvider, "grant_1")).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_INVALID",
    );
    await expect(
      setup({
        $id: "grant_1",
        provider: "github",
        envelope: "v1.AA.AA.AA",
      }).vault.open("github", "grant_1"),
    ).rejects.toThrow("APPWRITE_PROVIDER_GRANT_INVALID");
  });

  it("rejects invalid schema, key, nonce, reference, and lookup inputs", async () => {
    const tables = {
      createRow: vi.fn(),
      getRow: vi.fn(),
      deleteRow: vi.fn(),
    };
    expect(() =>
      createAppwriteProviderGrantVault(
        tables,
        { ...schema, providerGrantsTableId: "bad/id" },
        key,
        { createReference: () => "grant_1", createNonce: () => nonce },
      ),
    ).toThrow("APPWRITE_PROVIDER_GRANT_SCHEMA_INVALID");
    expect(() =>
      createAppwriteProviderGrantVault(tables, schema, Buffer.alloc(31), {
        createReference: () => "grant_1",
        createNonce: () => nonce,
      }),
    ).toThrow("APPWRITE_PROVIDER_GRANT_KEY_INVALID");

    const badNonce = createAppwriteProviderGrantVault(tables, schema, key, {
      createReference: () => "grant_1",
      createNonce: () => Buffer.alloc(11),
    });
    await expect(badNonce.seal("github", material)).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_NONCE_INVALID",
    );
    const badReference = createAppwriteProviderGrantVault(tables, schema, key, {
      createReference: () => "bad/id",
      createNonce: () => nonce,
    });
    await expect(badReference.seal("github", material)).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_REFERENCE_INVALID",
    );
    await expect(setup().vault.open("github", "bad/id")).rejects.toThrow(
      "APPWRITE_PROVIDER_GRANT_REFERENCE_INVALID",
    );

    const withDefaults = createAppwriteProviderGrantVault(tables, schema, key);
    await expect(
      withDefaults.seal("github", { accessToken: "default-randomness" }),
    ).resolves.toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u);
  });

  it("uses the real Node SDK TablesDB adapter", async () => {
    const row = { $id: "grant_1", provider: "github", envelope: "unused" };
    const tables = {
      createRow: vi.fn(
        (input: Parameters<AppwriteProviderGrantTablesPort["createRow"]>[0]) => {
          void input;
          return Promise.resolve({});
        },
      ),
      getRow: vi.fn(() => Promise.resolve(row)),
      deleteRow: vi.fn(() => Promise.resolve({})),
    };
    const vault = createNodeAppwriteProviderGrantVault(
      tables as unknown as import("node-appwrite").TablesDB,
      schema,
      key,
      { createReference: () => "grant_1", createNonce: () => nonce },
    );
    await vault.seal("github", material);
    const envelope = String(tables.createRow.mock.calls[0]?.[0].data.envelope);
    tables.getRow.mockResolvedValueOnce({ ...row, envelope });
    await expect(vault.open("github", "grant_1")).resolves.toEqual(material);
    tables.getRow.mockResolvedValueOnce({ ...row, envelope });
    await vault.remove("github", "grant_1");
    expect(tables.createRow).toHaveBeenCalledOnce();
    expect(tables.deleteRow).toHaveBeenCalledOnce();
  });
});
