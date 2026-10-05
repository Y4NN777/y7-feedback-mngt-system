import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authenticateProviderWebhook } from "./provider-webhook-auth.js";

const encoder = new TextEncoder();
const body = '{"repository":{"id":1329343404},"action":"edited"}';
const githubSecret = "github-webhook-secret-with-at-least-32-bytes";

describe("provider webhook authentication", () => {
  it("BDD-SYNC-001 authenticates GitHub over the unmodified raw body", () => {
    const signature = `sha256=${createHmac("sha256", githubSecret).update(body).digest("hex")}`;
    expect(
      authenticateProviderWebhook({
        provider: "github",
        headers: {
          "X-GitHub-Delivery": "delivery-1",
          "X-GitHub-Event": "issues",
          "X-Hub-Signature-256": signature,
        },
        body: encoder.encode(body),
        credential: { kind: "github_hmac", secret: githubSecret },
        nowSeconds: 1_800_000_000,
      }),
    ).toEqual({
      provider: "github",
      deliveryId: "delivery-1",
      eventType: "issues",
      rawBody: body,
    });
  });

  it("BDD-SYNC-002 denies missing, malformed, tampered and wrong-provider signatures", () => {
    const base = {
      provider: "github" as const,
      headers: {
        "x-github-delivery": "delivery-1",
        "x-github-event": "issues",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: encoder.encode(body),
      credential: { kind: "github_hmac" as const, secret: githubSecret },
      nowSeconds: 1_800_000_000,
    };
    expect(authenticateProviderWebhook(base)).toBeNull();
    expect(authenticateProviderWebhook({ ...base, body: new Uint8Array() })).toBeNull();
    expect(
      authenticateProviderWebhook({
        ...base,
        credential: {
          kind: "gitlab_legacy",
          secret: "gitlab-webhook-secret-with-at-least-32-bytes",
        },
      }),
    ).toBeNull();
  });

  it("BDD-SYNC-003 authenticates current GitLab Standard Webhooks signatures", () => {
    const rawKey = Buffer.alloc(32, 7);
    const signingToken = `whsec_${rawKey.toString("base64")}`;
    const deliveryId = "gitlab-delivery-1";
    const timestamp = "1800000000";
    const signature = `v1,${createHmac("sha256", rawKey)
      .update(`${deliveryId}.${timestamp}.${body}`)
      .digest("base64")}`;
    expect(
      authenticateProviderWebhook({
        provider: "gitlab",
        headers: {
          "webhook-id": deliveryId,
          "webhook-timestamp": timestamp,
          "webhook-signature": `v1,rotated ${signature}`,
          "x-gitlab-event": "Issue Hook",
        },
        body: encoder.encode(body),
        credential: { kind: "gitlab_hmac", signingToken },
        nowSeconds: 1_800_000_100,
      }),
    ).toMatchObject({ provider: "gitlab", deliveryId, eventType: "Issue Hook" });
  });

  it("BDD-SYNC-004 rejects stale GitLab signatures and supports bounded legacy migration", () => {
    const secret = "gitlab-webhook-secret-with-at-least-32-bytes";
    const legacy = authenticateProviderWebhook({
      provider: "gitlab",
      headers: {
        "idempotency-key": "gitlab-delivery-2",
        "x-gitlab-token": secret,
        "x-gitlab-event": "Note Hook",
      },
      body: encoder.encode(body),
      credential: { kind: "gitlab_legacy", secret },
      nowSeconds: 1_800_000_000,
    });
    expect(legacy).toMatchObject({ deliveryId: "gitlab-delivery-2" });

    const rawKey = Buffer.alloc(32, 9);
    const timestamp = "1799999000";
    const deliveryId = "gitlab-delivery-3";
    const signature = `v1,${createHmac("sha256", rawKey)
      .update(`${deliveryId}.${timestamp}.${body}`)
      .digest("base64")}`;
    expect(
      authenticateProviderWebhook({
        provider: "gitlab",
        headers: {
          "webhook-id": deliveryId,
          "webhook-timestamp": timestamp,
          "webhook-signature": signature,
          "x-gitlab-event": "Issue Hook",
        },
        body: encoder.encode(body),
        credential: {
          kind: "gitlab_hmac",
          signingToken: `whsec_${rawKey.toString("base64")}`,
        },
        nowSeconds: 1_800_000_000,
      }),
    ).toBeNull();
  });

  it("BDD-SYNC-005 bounds identifiers, event names, encoding and payload size", () => {
    const signature = `sha256=${createHmac("sha256", githubSecret).update(body).digest("hex")}`;
    const input = {
      provider: "github" as const,
      headers: {
        "x-github-delivery": "delivery-1",
        "x-github-event": "issues",
        "x-hub-signature-256": signature,
      },
      body: encoder.encode(body),
      credential: { kind: "github_hmac" as const, secret: githubSecret },
      nowSeconds: 1_800_000_000,
    };
    expect(
      authenticateProviderWebhook({
        ...input,
        headers: { ...input.headers, "x-github-delivery": "../invalid" },
      }),
    ).toBeNull();
    expect(
      authenticateProviderWebhook({
        ...input,
        headers: { ...input.headers, "x-github-event": "issues\nforged" },
      }),
    ).toBeNull();
    expect(
      authenticateProviderWebhook({ ...input, body: new Uint8Array([0xff]) }),
    ).toBeNull();
    expect(
      authenticateProviderWebhook({ ...input, body: new Uint8Array(1_048_577) }),
    ).toBeNull();
    expect(authenticateProviderWebhook({ ...input, nowSeconds: -1 })).toBeNull();
    expect(authenticateProviderWebhook({ ...input, nowSeconds: 1.5 })).toBeNull();
  });

  it("exhaustively rejects malformed GitLab Standard Webhooks headers", () => {
    const rawKey = Buffer.alloc(32, 8);
    const signingToken = `whsec_${rawKey.toString("base64")}`;
    const deliveryId = "gitlab-delivery-4";
    const timestamp = "1800000000";
    const signature = `v1,${createHmac("sha256", rawKey)
      .update(`${deliveryId}.${timestamp}.${body}`)
      .digest("base64")}`;
    const valid = {
      provider: "gitlab" as const,
      headers: {
        "webhook-id": deliveryId,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
        "x-gitlab-event": "Issue Hook",
      },
      body: encoder.encode(body),
      credential: { kind: "gitlab_hmac" as const, signingToken },
      nowSeconds: 1_800_000_000,
    };
    const cases: readonly (typeof valid)[] = [
      { ...valid, headers: { ...valid.headers, "x-gitlab-event": "" } },
      {
        ...valid,
        credential: {
          kind: "gitlab_hmac",
          signingToken: "not-a-signing-token",
        },
      },
      {
        ...valid,
        credential: {
          kind: "gitlab_hmac",
          signingToken: `whsec_${Buffer.alloc(31, 8).toString("base64")}`,
        },
      },
      { ...valid, headers: { ...valid.headers, "webhook-id": "" } },
      { ...valid, headers: { ...valid.headers, "webhook-id": "../invalid" } },
      { ...valid, headers: { ...valid.headers, "webhook-timestamp": "" } },
      { ...valid, headers: { ...valid.headers, "webhook-timestamp": "1.5" } },
      { ...valid, headers: { ...valid.headers, "webhook-signature": "v1,wrong" } },
    ];
    for (const candidate of cases) {
      expect(authenticateProviderWebhook(candidate)).toBeNull();
    }
    expect(
      authenticateProviderWebhook({
        ...valid,
        credential: {
          kind: "gitlab_legacy",
          secret: "gitlab-webhook-secret-with-at-least-32-bytes",
        },
      }),
    ).toBeNull();
  });

  it("exhaustively rejects malformed GitLab legacy headers and uses the UUID fallback", () => {
    const secret = "gitlab-webhook-secret-with-at-least-32-bytes";
    const valid = {
      provider: "gitlab" as const,
      headers: {
        "x-gitlab-webhook-uuid": "gitlab-uuid-1",
        "x-gitlab-token": secret,
        "x-gitlab-event": "Issue Hook",
      },
      body: encoder.encode(body),
      credential: { kind: "gitlab_legacy" as const, secret },
      nowSeconds: 1_800_000_000,
    };
    expect(authenticateProviderWebhook(valid)).toMatchObject({
      deliveryId: "gitlab-uuid-1",
    });
    const cases = [
      { ...valid, headers: { ...valid.headers, "x-gitlab-webhook-uuid": "" } },
      {
        ...valid,
        headers: { ...valid.headers, "x-gitlab-webhook-uuid": "../invalid" },
      },
      { ...valid, headers: { ...valid.headers, "x-gitlab-token": "" } },
      { ...valid, headers: { ...valid.headers, "x-gitlab-token": "wrong" } },
      {
        ...valid,
        credential: { kind: "gitlab_legacy" as const, secret: "short" },
      },
      {
        ...valid,
        credential: { kind: "github_hmac" as const, secret: githubSecret },
      },
    ];
    for (const candidate of cases) {
      expect(authenticateProviderWebhook(candidate)).toBeNull();
    }
  });
});
