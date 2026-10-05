import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createProviderWebhookIngress,
  type ProviderWebhookAuthority,
} from "./provider-webhook-ingress.js";

const secret = "github-webhook-secret-with-at-least-32-bytes";
const raw = '{"action":"edited","repository":{"id":1329343404}}';
const body = new TextEncoder().encode(raw);
const headers = {
  "x-github-delivery": "delivery-1",
  "x-github-event": "issues",
  "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
};
const authority: ProviderWebhookAuthority = {
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "1329343404",
  credential: { kind: "github_hmac", secret },
  active: true,
};

function harness(
  overrides: {
    readonly resolved?: ProviderWebhookAuthority | null;
    readonly accepted?: "accepted" | "duplicate";
    readonly resolveFailure?: boolean;
    readonly acceptFailure?: boolean;
    readonly now?: Date;
  } = {},
) {
  const resolve = overrides.resolveFailure
    ? vi.fn(() => Promise.reject(new Error("unavailable")))
    : vi.fn(() =>
        Promise.resolve(
          overrides.resolved === undefined ? authority : overrides.resolved,
        ),
      );
  const accept = overrides.acceptFailure
    ? vi.fn(() => Promise.reject(new Error("unavailable")))
    : vi.fn(() => Promise.resolve(overrides.accepted ?? ("accepted" as const)));
  const ingress = createProviderWebhookIngress({
    authorities: { resolve },
    inbox: { accept },
    now: () => overrides.now ?? new Date("2026-09-01T12:00:00.000Z"),
  });
  return { ingress, resolve, accept };
}

describe("provider webhook ingress", () => {
  it("BDD-SYNC-006 derives authority, authenticates and persists a minimal envelope", async () => {
    const { ingress, resolve, accept } = harness();
    await expect(
      ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(resolve).toHaveBeenCalledWith({
      provider: "github",
      connectionId: "connection_1",
    });
    expect(accept).toHaveBeenCalledWith({
      provider: "github",
      deliveryId: "delivery-1",
      eventType: "issues",
      connectionId: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      repositoryId: "1329343404",
      payload: raw,
      payloadDigest: createHash("sha256").update(raw).digest("base64url"),
      receivedAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("BDD-SYNC-007 acknowledges one duplicate without a second semantic event", async () => {
    const { ingress, accept } = harness({ accepted: "duplicate" });
    await expect(
      ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "duplicate" });
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("BDD-SYNC-008 denies inactive, foreign-repository and forged deliveries", async () => {
    for (const resolved of [
      null,
      { ...authority, active: false },
      { ...authority, repositoryId: "other-repository" },
    ]) {
      const { ingress, accept } = harness({ resolved });
      await expect(
        ingress.accept({
          provider: "github",
          connectionId: "connection_1",
          headers,
          body,
        }),
      ).resolves.toEqual({ status: "denied" });
      expect(accept).not.toHaveBeenCalled();
    }
    const { ingress, accept } = harness();
    await expect(
      ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers: { ...headers, "x-hub-signature-256": "sha256=forged" },
        body,
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(accept).not.toHaveBeenCalled();
  });

  it("BDD-SYNC-009 rejects malformed coordinates and payloads before persistence", async () => {
    const invalidCoordinate = harness();
    await expect(
      invalidCoordinate.ingress.accept({
        provider: "github",
        connectionId: "../connection",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(invalidCoordinate.resolve).not.toHaveBeenCalled();

    const malformedRaw = "not-json";
    const malformed = harness();
    await expect(
      malformed.ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers: {
          ...headers,
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(malformedRaw).digest("hex")}`,
        },
        body: new TextEncoder().encode(malformedRaw),
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(malformed.accept).not.toHaveBeenCalled();
  });

  it("BDD-SYNC-010 maps authority, envelope and inbox failures to retryable", async () => {
    const authorityFailure = harness({ resolveFailure: true });
    await expect(
      authorityFailure.ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "retryable" });

    const storeFailure = harness({ acceptFailure: true });
    await expect(
      storeFailure.ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "retryable" });

    const invalidClock = harness({ now: new Date(Number.NaN) });
    await expect(
      invalidClock.ingress.accept({
        provider: "github",
        connectionId: "connection_1",
        headers,
        body,
      }),
    ).resolves.toEqual({ status: "retryable" });
  });

  it("BDD-SYNC-011 denies every malformed authority coordinate", async () => {
    for (const resolved of [
      { ...authority, connectionId: "other" },
      { ...authority, connectionId: "../bad" },
      { ...authority, workspaceId: "../bad" },
      { ...authority, projectId: "../bad" },
      { ...authority, repositoryId: "../bad" },
    ]) {
      const { ingress } = harness({ resolved });
      await expect(
        ingress.accept({
          provider: "github",
          connectionId: "connection_1",
          headers,
          body,
        }),
      ).resolves.toEqual({ status: "denied" });
    }
  });

  it("BDD-SYNC-012 extracts current and legacy GitLab project identities", async () => {
    const gitlabSecret = "gitlab-legacy-secret-with-at-least-32-bytes";
    const resolved: ProviderWebhookAuthority = {
      ...authority,
      repositoryId: "83836910",
      credential: { kind: "gitlab_legacy", secret: gitlabSecret },
    };
    for (const payload of [{ project: { id: 83836910 } }, { project_id: "83836910" }]) {
      const payloadRaw = JSON.stringify(payload);
      const { ingress } = harness({ resolved });
      await expect(
        ingress.accept({
          provider: "gitlab",
          connectionId: "connection_1",
          headers: {
            "x-gitlab-token": gitlabSecret,
            "x-gitlab-event": "Push Hook",
            "idempotency-key": "delivery-2",
          },
          body: new TextEncoder().encode(payloadRaw),
        }),
      ).resolves.toEqual({ status: "accepted" });
    }
  });

  it("BDD-SYNC-013 denies absent, unsafe and malformed repository identities", async () => {
    for (const payload of [
      null,
      [],
      {},
      { repository: null },
      { repository: { id: Number.MAX_SAFE_INTEGER + 1 } },
      { repository: { id: "../unsafe" } },
    ]) {
      const payloadRaw = JSON.stringify(payload);
      const { ingress } = harness();
      await expect(
        ingress.accept({
          provider: "github",
          connectionId: "connection_1",
          headers: {
            ...headers,
            "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payloadRaw).digest("hex")}`,
          },
          body: new TextEncoder().encode(payloadRaw),
        }),
      ).resolves.toEqual({ status: "denied" });
    }
  });
});
