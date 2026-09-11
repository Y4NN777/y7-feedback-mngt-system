import { describe, expect, it } from "vitest";

import { createSensitiveDataProtector } from "./sensitive-data-protector";
import {
  createAttachmentStagingTokenCodec,
  type AttachmentStagingGrant,
} from "./attachment-staging-token";

const grant: AttachmentStagingGrant = {
  attachmentId: "attachment_1",
  objectId: "private/object_1",
  operationId: "123e4567-e89b-42d3-a456-426614174000",
  workspaceId: "workspace_1",
  projectId: "project_1",
  displayName: "evidence.txt",
  mediaType: "text/plain; charset=utf-8",
  size: 8,
  sha256: "a".repeat(64),
  stagedAt: "2026-09-11T00:00:00.000Z",
};

function codec(now = "2026-09-11T00:05:00.000Z") {
  return createAttachmentStagingTokenCodec(
    {
      environment: "preview",
      protector: createSensitiveDataProtector(
        "data_1",
        [{ id: "data_1", material: Buffer.alloc(32, 7) }],
        () => Buffer.alloc(12, 9),
      ),
    },
    { tableId: "attachments", now: () => now, ttlMs: 15 * 60 * 1_000 },
  );
}

describe("encrypted Attachment staging grants", () => {
  it("BDD-ATT-UC03-001 round-trips only server-validated metadata", () => {
    const target = codec();
    const token = target.issue(grant);

    expect(token).not.toContain(grant.displayName);
    expect(token).not.toContain(grant.objectId);
    expect(target.verify(grant.attachmentId, token)).toEqual(grant);
  });

  it("BDD-ATT-UC03-002 binds the token to its Attachment and environment", () => {
    const token = codec().issue(grant);

    expect(() => codec().verify("attachment_2", token)).toThrow(
      "ATTACHMENT_STAGING_TOKEN_INVALID",
    );
    expect(() => {
      const production = createAttachmentStagingTokenCodec(
        {
          environment: "production",
          protector: createSensitiveDataProtector("data_1", [
            { id: "data_1", material: Buffer.alloc(32, 7) },
          ]),
        },
        {
          tableId: "attachments",
          now: () => "2026-09-11T00:05:00.000Z",
          ttlMs: 15 * 60 * 1_000,
        },
      );
      production.verify(grant.attachmentId, token);
    }).toThrow("ATTACHMENT_STAGING_TOKEN_INVALID");
  });

  it("BDD-ATT-UC03-003 rejects tampering, expiry and malformed grants uniformly", () => {
    const target = codec();
    const token = target.issue(grant);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(() => target.verify(grant.attachmentId, tampered)).toThrow(
      "ATTACHMENT_STAGING_TOKEN_INVALID",
    );
    expect(() =>
      codec("2026-09-11T00:15:00.001Z").verify(grant.attachmentId, token),
    ).toThrow("ATTACHMENT_STAGING_TOKEN_INVALID");
    expect(() => target.issue({ ...grant, objectId: "public/object_1" })).toThrow(
      "ATTACHMENT_STAGING_TOKEN_INVALID",
    );
    expect(() => target.issue({ ...grant, size: 10 * 1024 * 1024 + 1 })).toThrow(
      "ATTACHMENT_STAGING_TOKEN_INVALID",
    );
  });
});
