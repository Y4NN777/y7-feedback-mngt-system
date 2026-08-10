import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePublicProjectReader,
  createNodeAppwritePublicProjectReader,
  type AppwriteProjectQueryPort,
  type AppwriteProjectTablesPort,
} from "./appwrite-public-project-reader";

const schema = {
  databaseId: "feedback",
  projectsTableId: "projects",
};

const row = {
  $id: "project-authoritative",
  workspaceId: "workspace-authoritative",
  slug: "wisemoney",
  active: true,
  enabledTypesJson: '["bug","suggestion","review"]',
  contextDeclarationsJson: JSON.stringify([
    {
      name: "applicationVersion",
      type: "string",
      purpose: "Identifier la version concernée",
    },
  ]),
  reporterPurposeFr: "Recontacter la personne au sujet de ce retour",
  reporterPurposeEn: "Contact the person about this feedback",
  projectId: "forged-column",
};

function setup(rows: readonly unknown[] = [row]) {
  const listRows = vi.fn(() => Promise.resolve({ rows }));
  const tables: AppwriteProjectTablesPort = { listRows };
  const queries: AppwriteProjectQueryPort = {
    equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
    limit: (limit) => `limit:${String(limit)}`,
  };
  return {
    listRows,
    reader: createAppwritePublicProjectReader(tables, schema, queries),
  };
}

describe("Appwrite public Project registry adapter", () => {
  it("BDD-PROJ-APPWRITE-001 derives Project identity from the exact authoritative row", async () => {
    const { listRows, reader } = setup();

    await expect(reader.findBySlug("wisemoney")).resolves.toEqual({
      slug: "wisemoney",
      feedbackConfig: {
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
      },
      reporterPurpose: {
        fr: "Recontacter la personne au sujet de ce retour",
        en: "Contact the person about this feedback",
      },
    });
    expect(listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "projects",
      queries: ["equal:slug:wisemoney", "limit:2"],
      total: false,
      ttl: 0,
    });
  });

  it("returns null without enumeration when the slug is absent", async () => {
    const { reader } = setup([]);
    await expect(reader.findBySlug("unknown")).resolves.toBeNull();
  });

  it("fails closed for duplicate or inconsistent authoritative rows", async () => {
    const malformedRows: readonly (readonly unknown[])[] = [
      [row, { ...row, $id: "project-second" }],
      [null],
      [{ ...row, $id: "" }],
      [{ ...row, workspaceId: 42 }],
      [{ ...row, slug: "another" }],
      [{ ...row, active: "true" }],
      [{ ...row, enabledTypesJson: "not-json" }],
      [{ ...row, enabledTypesJson: "{}" }],
      [{ ...row, enabledTypesJson: '["bug","unknown"]' }],
      [{ ...row, contextDeclarationsJson: "{}" }],
      [{ ...row, reporterPurposeFr: " " }],
      [{ ...row, reporterPurposeEn: "x".repeat(301) }],
    ];

    for (const rows of malformedRows) {
      const { reader } = setup(rows);
      await expect(reader.findBySlug("wisemoney")).rejects.toThrow(
        "APPWRITE_PROJECT_ROW_INVALID",
      );
    }
  });

  it("rejects unsafe lookup input and schema before Appwrite access", async () => {
    const { reader, listRows } = setup();
    await expect(reader.findBySlug("../wisemoney")).rejects.toThrow(
      "APPWRITE_PROJECT_SLUG_INVALID",
    );
    expect(listRows).not.toHaveBeenCalled();

    for (const invalidSchema of [
      { ...schema, databaseId: "" },
      { ...schema, projectsTableId: "bad/table" },
    ]) {
      expect(() =>
        createAppwritePublicProjectReader({ listRows }, invalidSchema, {
          equal: () => "query",
          limit: () => "limit",
        }),
      ).toThrow("APPWRITE_PROJECT_SCHEMA_INVALID");
    }
  });

  it("uses the real Appwrite query encoder through the Node SDK adapter", async () => {
    const listRows = vi.fn(() => Promise.resolve({ rows: [row] }));
    const reader = createNodeAppwritePublicProjectReader(
      { listRows } as unknown as import("node-appwrite").TablesDB,
      schema,
    );

    await expect(reader.findBySlug("wisemoney")).resolves.toMatchObject({
      slug: "wisemoney",
    });
    expect(listRows).toHaveBeenCalledOnce();
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: [expect.any(String), expect.any(String)],
      }),
    );
  });
});
