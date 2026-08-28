import { describe, expect, it } from "vitest";

import { ConfigError } from "./public";
import { parseServerConfig } from "./server";

const validServer = {
  Y7_ENVIRONMENT: "preview",
  APPWRITE_ENVIRONMENT: "preview",
  APPWRITE_ENDPOINT: "https://preview.appwrite.example/v1",
  APPWRITE_PROJECT_ID: "feedback-preview",
  APPWRITE_API_KEY: "server-only-key",
  Y7_WEB_ORIGIN: "https://y7-feedback.vercel.app",
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
  APPWRITE_NOTIFICATION_SIGNALS_TABLE_ID: "notification_signals",
  APPWRITE_OUTBOX_TABLE_ID: "notification_outbox",
  APPWRITE_IDEMPOTENCY_TABLE_ID: "intake_idempotency",
  APPWRITE_ATTACHMENT_BUCKET_ID: "private_attachments",
  APPWRITE_ATTACHMENT_STAGING_TABLE_ID: "attachment_staging",
  APPWRITE_ATTACHMENTS_TABLE_ID: "attachments",
  APPWRITE_PROVIDER_GRANTS_TABLE_ID: "provider_grants",
  APPWRITE_SOURCE_CONNECTIONS_TABLE_ID: "source_connections",
  APPWRITE_ADMINISTRATION_AUDIT_TABLE_ID: "administration_audit",
  APPWRITE_ADMINISTRATION_IDEMPOTENCY_TABLE_ID: "administration_idempotency",
  APPWRITE_CONVERSATION_MESSAGES_TABLE_ID: "conversation_messages",
  APPWRITE_CONVERSATION_INTERNAL_NOTES_TABLE_ID: "conversation_internal_notes",
  APPWRITE_CONVERSATION_IDEMPOTENCY_TABLE_ID: "conversation_idempotency",
  APPWRITE_CONVERSATION_LIFECYCLE_TABLE_ID: "conversation_lifecycle",
  APPWRITE_PUBLICATION_CONSENTS_TABLE_ID: "publication_consents",
  APPWRITE_EXTERNAL_ISSUE_LINKS_TABLE_ID: "external_issue_links",
  APPWRITE_PROVIDER_OUTBOX_TABLE_ID: "provider_outbox",
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
      webOrigin: "https://y7-feedback.vercel.app",
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
        notificationSignalsTableId: "notification_signals",
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
        conversationLifecycleTableId: "conversation_lifecycle",
        publicationConsentsTableId: "publication_consents",
        externalIssueLinksTableId: "external_issue_links",
        providerOutboxTableId: "provider_outbox",
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

  it("BDD-ISSUE-CONFIG-001 requires a canonical secure Web origin", () => {
    expect(
      parseServerConfig({
        ...validServer,
        Y7_WEB_ORIGIN: "https://y7-feedback.vercel.app/",
      }).webOrigin,
    ).toBe("https://y7-feedback.vercel.app");
    for (const value of [
      "https://user@example.test",
      "https://example.test/path",
      "https://example.test/?query=1",
      "https://example.test/#fragment",
      "http://example.test",
    ]) {
      expect(() =>
        parseServerConfig({ ...validServer, Y7_WEB_ORIGIN: value }),
      ).toThrow();
    }
  });

  it("BDD-SRC-REAL-005 accepts provider authority only as a complete server-only set", () => {
    const providerVariables = {
      GITHUB_APP_CLIENT_ID: "github-client-id",
      GITHUB_APP_CLIENT_SECRET: "github-client-secret",
      GITHUB_APP_CALLBACK_URL: "https://preview-api.example/providers/github/callback",
      GITLAB_OAUTH_CLIENT_ID: "gitlab-client-id",
      GITLAB_OAUTH_CLIENT_SECRET: "gitlab-client-secret",
      GITLAB_OAUTH_CALLBACK_URL:
        "https://preview-api.example/providers/gitlab/callback",
      GITLAB_OAUTH_ORIGIN: "https://gitlab.com",
    };

    expect(
      parseServerConfig({ ...validServer, ...providerVariables }).providers,
    ).toEqual({
      github: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
        callbackUrl: "https://preview-api.example/providers/github/callback",
      },
      gitlab: {
        clientId: "gitlab-client-id",
        clientSecret: "gitlab-client-secret",
        callbackUrl: "https://preview-api.example/providers/gitlab/callback",
        origin: "https://gitlab.com/",
      },
    });
    expect(parseServerConfig(validServer).providers).toBeUndefined();
    expect(() =>
      parseServerConfig({
        ...validServer,
        ...providerVariables,
        GITHUB_APP_CLIENT_SECRET: undefined,
      }),
    ).toThrow(new ConfigError("PROVIDER_CONFIG_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        ...providerVariables,
        GITLAB_OAUTH_CALLBACK_URL: "http://preview-api.example/callback",
      }),
    ).toThrow(new ConfigError("PROVIDER_CONFIG_INVALID"));
    expect(() =>
      parseServerConfig({
        ...validServer,
        ...providerVariables,
        GITHUB_APP_CALLBACK_URL: "not-a-url",
      }),
    ).toThrow(new ConfigError("PROVIDER_CONFIG_INVALID"));
  });
});
