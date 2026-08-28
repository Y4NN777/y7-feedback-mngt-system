import { describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application";
import { routeRequest, type FunctionContext } from "./http";

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const config: ServerConfig = {
  environment: "preview",
  backendEnvironment: "preview",
  appwriteEndpoint: "https://preview.appwrite.example/v1",
  appwriteProjectId: "feedback-preview",
  appwriteApiKey: "server-only-key",
  appwriteSchema: {
    databaseId: "feedback",
    workspacesTableId: "workspaces",
    workspaceMembershipsTableId: "workspace_memberships",
    projectAssignmentsTableId: "project_assignments",
    projectSlugsTableId: "project_slugs",
    projectsTableId: "projects",
    reportersTableId: "reporters",
    feedbackTableId: "feedback",
    lifecycleTableId: "feedback_lifecycle",
    accessGrantsTableId: "access_grants",
    notificationsTableId: "notifications",
    outboxTableId: "notification_outbox",
    idempotencyTableId: "intake_idempotency",
    attachmentBucketId: "private_attachments",
    attachmentStagingTableId: "attachment_staging",
    attachmentsTableId: "attachments",
    providerGrantsTableId: "provider_grants",
    sourceConnectionsTableId: "source_connections",
    administrationAuditTableId: "administration_audit",
    administrationIdempotencyTableId: "administration_idempotency",
    conversationMessagesTableId: "conversation_messages",
    conversationInternalNotesTableId: "conversation_internal_notes",
    conversationIdempotencyTableId: "conversation_idempotency",
  },
  accessProofEnvelopeKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  providerGrantEnvelopeKey: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
  sensitiveDataActiveKeyId: "data_2026_08",
  sensitiveDataEnvelopeKeys: {
    data_2026_08: "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
  },
  release: "commit-application",
};

class FakeTables {
  readonly rows: Array<Readonly<Record<string, unknown>>> = [];

  listRows(input: { readonly tableId: string }) {
    if (input.tableId === "projects") {
      return Promise.resolve({
        rows: [
          {
            $id: "project-authoritative",
            workspaceId: "workspace-authoritative",
            slug: "wisemoney",
            active: true,
            enabledTypesJson: '["bug"]',
            contextDeclarationsJson: "[]",
            reporterPurposeFr: "Recontacter la personne pour ce retour",
            reporterPurposeEn: "Contact the person about this feedback",
          },
        ],
      });
    }
    if (input.tableId === "workspace_memberships") {
      return Promise.resolve({
        rows: [
          {
            $id: "membership-owner",
            workspaceId: "workspace-admin",
            userId: "owner-admin",
            role: "workspace_owner",
            status: "active",
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  createTransaction() {
    return Promise.resolve({ $id: "transaction-1" });
  }

  createRow(input: Readonly<Record<string, unknown>>) {
    this.rows.push(input);
    return Promise.resolve({ $id: input.rowId });
  }

  updateTransaction() {
    return Promise.resolve({});
  }

  getRow() {
    return Promise.reject(new Error("not used"));
  }

  updateRow() {
    return Promise.resolve({});
  }
}

describe("trusted Function composition root", () => {
  it("BDD-INTAKE-COMPOSE-001 accepts through HTTP and a private Appwrite transaction", async () => {
    const tables = new FakeTables();
    let sequence = 0;
    const dependencies = createHttpApplication(config, {
      tables: tables as unknown as import("node-appwrite").TablesDB,
      storage: {} as import("node-appwrite").Storage,
      createId: () => `generated-${String(++sequence)}`,
      createReference: () => "Y7-2026-000001",
      createCorrelationId: () => "correlation-1",
      nowIso: () => "2026-08-10T14:00:00.000Z",
      nowMs: () => 104,
      startedAt: () => 100,
    });
    const json =
      vi.fn<
        (
          body: unknown,
          statusCode?: number,
          headers?: Readonly<Record<string, string>>,
        ) => unknown
      >();
    const context: FunctionContext = {
      req: {
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        bodyJson: {
          clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
          locale: "fr",
          feedback: {
            type: "bug",
            source: { type: "bug", problem: "Le solde est incorrect." },
            reporter: { kind: "unidentified" },
            context: [],
            attachmentNames: [],
          },
        },
      },
      res: { json },
      log: vi.fn(),
      error: vi.fn(),
    };

    await routeRequest(context, dependencies);

    const response: unknown = json.mock.calls[0]?.[0];
    if (!isObject(response) || typeof response.accessProof !== "string") {
      throw new Error("expected accepted response");
    }
    const proof = response.accessProof;
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(json).toHaveBeenCalledWith(
      {
        status: "accepted",
        reference: "Y7-2026-000001",
        accessProof: proof,
        replayed: false,
      },
      201,
      expect.objectContaining({
        "cache-control": "no-store",
        "x-correlation-id": "correlation-1",
      }),
    );
    expect(tables.rows).toHaveLength(7);
    expect(tables.rows.every((row) => JSON.stringify(row.permissions) === "[]")).toBe(
      true,
    );
    const persisted = JSON.stringify(tables.rows);
    expect(persisted).not.toContain(proof);
    expect(persisted).not.toContain("Le solde est incorrect.");
    expect(persisted).toContain("v1.");
  });

  it("BDD-ADMIN-001 composes the trusted Owner route and atomic Appwrite store", async () => {
    const tables = new FakeTables();
    let sequence = 0;
    const dependencies = createHttpApplication(config, {
      tables: tables as unknown as import("node-appwrite").TablesDB,
      storage: {} as import("node-appwrite").Storage,
      createId: () => `generated-${String(++sequence)}`,
      createReference: () => "unused",
      createCorrelationId: () => "correlation-admin",
      nowIso: () => "2026-08-28T10:00:00.000Z",
      nowMs: () => 104,
      startedAt: () => 100,
      principalVerifier: {
        verify: () =>
          Promise.resolve({ status: "verified", principalId: "owner-admin" }),
      },
    });
    const json = vi.fn();
    const context: FunctionContext = {
      req: {
        method: "POST",
        path: "/v1/workspaces/workspace-admin/projects",
        headers: {
          authorization: "Bearer aaa.bbb.ccc",
          "content-type": "application/json",
        },
        bodyJson: {
          kind: "create_project",
          operationId: "operation-admin",
          workspaceId: "workspace-admin",
          projectId: "project-admin",
          slug: "admin-project",
          enabledTypes: ["bug"],
          contextDeclarations: [],
          reporterPurpose: { fr: "But français", en: "English purpose" },
        },
      },
      res: { json },
      log: vi.fn(),
      error: vi.fn(),
    };

    await routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledWith(
      {
        status: "ok",
        project: { projectId: "project-admin", slug: "admin-project" },
      },
      201,
      expect.any(Object),
    );
    expect(tables.rows.slice(-4).map((row) => row.tableId)).toEqual([
      "projects",
      "project_slugs",
      "administration_audit",
      "administration_idempotency",
    ]);
  });
});
