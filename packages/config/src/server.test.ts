import { describe, expect, it } from "vitest";

import { ConfigError } from "./public";
import { parseServerConfig } from "./server";

const validServer = {
  Y7_ENVIRONMENT: "preview",
  APPWRITE_ENVIRONMENT: "preview",
  APPWRITE_ENDPOINT: "https://preview.appwrite.example/v1",
  APPWRITE_PROJECT_ID: "feedback-preview",
  APPWRITE_API_KEY: "server-only-key",
  APPWRITE_DATABASE_ID: "feedback",
  APPWRITE_WORKSPACES_TABLE_ID: "workspaces",
  APPWRITE_WORKSPACE_MEMBERSHIPS_TABLE_ID: "workspace_memberships",
  APPWRITE_PROJECT_ASSIGNMENTS_TABLE_ID: "project_assignments",
  APPWRITE_PROJECT_SLUGS_TABLE_ID: "project_slugs",
  APPWRITE_PROJECTS_TABLE_ID: "projects",
  APPWRITE_REPORTERS_TABLE_ID: "reporters",
  APPWRITE_FEEDBACK_TABLE_ID: "feedback",
  APPWRITE_LIFECYCLE_TABLE_ID: "feedback_lifecycle",
  APPWRITE_ACCESS_GRANTS_TABLE_ID: "access_grants",
  APPWRITE_NOTIFICATIONS_TABLE_ID: "notifications",
  APPWRITE_OUTBOX_TABLE_ID: "notification_outbox",
  APPWRITE_IDEMPOTENCY_TABLE_ID: "intake_idempotency",
  APPWRITE_ATTACHMENT_BUCKET_ID: "private_attachments",
  APPWRITE_ATTACHMENT_STAGING_TABLE_ID: "attachment_staging",
  APPWRITE_ATTACHMENTS_TABLE_ID: "attachments",
  APPWRITE_PROVIDER_GRANTS_TABLE_ID: "provider_grants",
  APPWRITE_SOURCE_CONNECTIONS_TABLE_ID: "source_connections",
  ACCESS_PROOF_ENVELOPE_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  PROVIDER_GRANT_ENVELOPE_KEY: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
  SENSITIVE_DATA_ACTIVE_KEY_ID: "data_2026_08",
  SENSITIVE_DATA_ENVELOPE_KEYS:
    '{"data_2026_07":"CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk","data_2026_08":"CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo"}',
  RELEASE: "commit-123",
};

describe("trusted environment contract", () => {
  it("BDD-ENV-003 requires and returns server-only authority", () => {
    expect(parseServerConfig(validServer)).toEqual({
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
      },
      accessProofEnvelopeKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      providerGrantEnvelopeKey: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
      sensitiveDataActiveKeyId: "data_2026_08",
      sensitiveDataEnvelopeKeys: {
        data_2026_07: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk",
        data_2026_08: "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
      },
      release: "commit-123",
    });
  });

  it("BDD-ENV-003 rejects missing server authority", () => {
    expect(() => parseServerConfig({ ...validServer, APPWRITE_API_KEY: "" })).toThrow(
      new ConfigError("CONFIG_MISSING"),
    );
  });

  it("BDD-ENV-004 rejects incomplete Appwrite schema and malformed proof keys", () => {
    expect(() =>
      parseServerConfig({ ...validServer, APPWRITE_DATABASE_ID: "" }),
    ).toThrow(new ConfigError("CONFIG_MISSING"));
    expect(() =>
      parseServerConfig({ ...validServer, APPWRITE_DATABASE_ID: "bad/id" }),
    ).toThrow(new ConfigError("APPWRITE_SCHEMA_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        APPWRITE_FEEDBACK_TABLE_ID: "reporters",
      }),
    ).toThrow(new ConfigError("APPWRITE_SCHEMA_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        APPWRITE_ATTACHMENT_STAGING_TABLE_ID: "attachments",
      }),
    ).toThrow(new ConfigError("APPWRITE_SCHEMA_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        APPWRITE_ATTACHMENT_BUCKET_ID: "",
      }),
    ).toThrow(new ConfigError("CONFIG_MISSING"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        ACCESS_PROOF_ENVELOPE_KEY: "not-a-32-byte-base64url-key",
      }),
    ).toThrow(new ConfigError("PROOF_KEY_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        PROVIDER_GRANT_ENVELOPE_KEY: validServer.ACCESS_PROOF_ENVELOPE_KEY,
      }),
    ).toThrow(new ConfigError("PROVIDER_GRANT_KEY_INVALID"));
  });

  it("BDD-DATA-ENC-005 requires a rotation-ready keyring separated by purpose", () => {
    for (const override of [
      { SENSITIVE_DATA_ACTIVE_KEY_ID: "missing" },
      { SENSITIVE_DATA_ACTIVE_KEY_ID: "bad/key" },
      { SENSITIVE_DATA_ENVELOPE_KEYS: "not-json" },
      { SENSITIVE_DATA_ENVELOPE_KEYS: "[]" },
      {
        SENSITIVE_DATA_ENVELOPE_KEYS: JSON.stringify({
          data_2026_08: validServer.ACCESS_PROOF_ENVELOPE_KEY,
        }),
      },
      {
        SENSITIVE_DATA_ENVELOPE_KEYS: JSON.stringify({
          data_2026_07: "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
          data_2026_08: "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
        }),
      },
    ]) {
      expect(() => parseServerConfig({ ...validServer, ...override })).toThrow(
        new ConfigError("SENSITIVE_DATA_KEYS_INVALID"),
      );
    }
  });
});
