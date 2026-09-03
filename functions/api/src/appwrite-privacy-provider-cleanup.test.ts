import type { TablesDB } from "node-appwrite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeAppwritePrivacyProviderCleanup } from "./appwrite-privacy-provider-cleanup";
import { closeProviderIssue } from "./provider-issue-cleanup";

vi.mock("./provider-issue-cleanup", () => ({ closeProviderIssue: vi.fn() }));

const schema = {
  databaseId: "feedback",
  externalIssueLinksTableId: "external_issue_links",
  sourceConnectionsTableId: "source_connections",
  providerGrantsTableId: "provider_grants",
} as const;
const link = {
  $id: "link_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  repositoryId: "1329343404",
  providerIssueUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system/issues/1",
  state: "privacy_deleted",
  synchronizationState: "privacy_cleanup_pending",
};
const connection = {
  $id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  status: "active",
  encryptedGrantRef: "grant_1",
  selectedRepositoriesJson: '[{"provider":"github","id":"1329343404"}]',
};

function setup(
  connectionValue: unknown = connection,
  links: readonly unknown[] = [link],
) {
  const listRows = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve({ rows: links });
  });
  const getRow = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve(connectionValue);
  });
  const updateRow = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve({});
  });
  const tables = { listRows, getRow, updateRow } as unknown as TablesDB;
  return {
    ...createNodeAppwritePrivacyProviderCleanup(tables, schema, {
      providerGrantEnvelopeKey: "a".repeat(43),
      gitlabOrigin: "https://gitlab.com/",
    }),
    listRows,
    updateRow,
  };
}

describe("Appwrite privacy provider cleanup", () => {
  beforeEach(() => vi.mocked(closeProviderIssue).mockReset());

  it("BDD-PRIV-050 lists only pending privacy links and marks closure", async () => {
    const target = setup();
    await expect(target.store.listPending(25)).resolves.toEqual([
      expect.objectContaining({ linkId: "link_1", repositoryId: "1329343404" }),
    ]);
    expect(target.listRows).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: schema.externalIssueLinksTableId }),
    );
    await target.store.markCompleted("link_1", "2026-09-03T12:00:00.000Z");
    expect(target.updateRow.mock.calls[0]?.[0]).toMatchObject({
      rowId: "link_1",
      data: { synchronizationState: "privacy_cleanup_completed" },
    });
  });

  it("BDD-PRIV-051 derives provider authority from the exact active connection", async () => {
    const target = setup();
    const [item] = await target.store.listPending(1);
    if (!item) throw new Error("fixture missing");
    vi.mocked(closeProviderIssue).mockResolvedValue();
    await target.closer.close(item);
    expect(vi.mocked(closeProviderIssue).mock.calls[0]?.[0]).toMatchObject({
      providerGrantRef: "grant_1",
      repository: { id: "1329343404" },
    });
  });

  it.each([
    { ...connection, status: "revoked" },
    { ...connection, projectId: "project_other" },
    { ...connection, selectedRepositoriesJson: "[]" },
    { ...connection, selectedRepositoriesJson: "not-json" },
  ])(
    "BDD-PRIV-052 denies missing, revoked or cross-scope authority",
    async (invalid) => {
      const target = setup(invalid);
      const [item] = await target.store.listPending(1);
      if (!item) throw new Error("fixture missing");
      await expect(target.closer.close(item)).rejects.toThrow(
        "APPWRITE_PRIVACY_PROVIDER_CLEANUP_AUTHORITY_INVALID",
      );
      expect(closeProviderIssue).not.toHaveBeenCalled();
    },
  );

  it("BDD-PRIV-053 rejects malformed persisted links and issue URLs", async () => {
    await expect(setup(undefined, [null]).store.listPending(1)).rejects.toThrow(
      "APPWRITE_PRIVACY_PROVIDER_CLEANUP_INVALID",
    );
    await expect(setup(undefined, [[]]).store.listPending(1)).rejects.toThrow(
      "APPWRITE_PRIVACY_PROVIDER_CLEANUP_INVALID",
    );
    await expect(setup(undefined, ["invalid"]).store.listPending(1)).rejects.toThrow(
      "APPWRITE_PRIVACY_PROVIDER_CLEANUP_INVALID",
    );
    await expect(
      setup(undefined, [{ ...link, state: "active" }]).store.listPending(1),
    ).rejects.toThrow("APPWRITE_PRIVACY_PROVIDER_CLEANUP_INVALID");
    const target = setup(connection, [{ ...link, providerIssueUrl: "not-a-url" }]);
    const [item] = await target.store.listPending(1);
    if (!item) throw new Error("fixture missing");
    await expect(target.closer.close(item)).rejects.toThrow(
      "APPWRITE_PRIVACY_PROVIDER_CLEANUP_URL_INVALID",
    );
    const missingCoordinates = setup(connection, [
      { ...link, providerIssueUrl: "https://github.com/" },
    ]);
    const [coordinateItem] = await missingCoordinates.store.listPending(1);
    if (!coordinateItem) throw new Error("fixture missing");
    await expect(missingCoordinates.closer.close(coordinateItem)).rejects.toThrow(
      "APPWRITE_PRIVACY_PROVIDER_CLEANUP_URL_INVALID",
    );
  });
});
