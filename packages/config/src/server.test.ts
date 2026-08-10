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
  ACCESS_PROOF_ENVELOPE_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  PROVIDER_GRANT_ENVELOPE_KEY: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
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
      },
      accessProofEnvelopeKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
      providerGrantEnvelopeKey: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
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
});
