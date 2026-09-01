import { createHmac, timingSafeEqual } from "node:crypto";

import type { SourceProvider } from "@y7-feedback/domain";

export type ProviderWebhookCredential =
  | { readonly kind: "github_hmac"; readonly secret: string }
  | { readonly kind: "gitlab_hmac"; readonly signingToken: string }
  | { readonly kind: "gitlab_legacy"; readonly secret: string };

export interface AuthenticatedProviderWebhook {
  readonly provider: SourceProvider;
  readonly deliveryId: string;
  readonly eventType: string;
  readonly rawBody: string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const eventType = /^[A-Za-z][A-Za-z0-9 _.-]{0,63}$/u;
const maximumPayloadBytes = 1_048_576;
const maximumClockSkewSeconds = 300;

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1]?.trim() || undefined;
}

function equal(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function bodyText(body: Uint8Array): string | null {
  if (body.byteLength === 0 || body.byteLength > maximumPayloadBytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function github(
  headers: Readonly<Record<string, string | undefined>>,
  rawBody: string,
  credential: ProviderWebhookCredential,
): AuthenticatedProviderWebhook | null {
  if (credential.kind !== "github_hmac" || credential.secret.length < 32) return null;
  const deliveryId = header(headers, "x-github-delivery");
  const received = header(headers, "x-hub-signature-256");
  const type = header(headers, "x-github-event");
  if (
    !deliveryId ||
    !identifier.test(deliveryId) ||
    !received ||
    !type ||
    !eventType.test(type)
  ) {
    return null;
  }
  const expected = `sha256=${createHmac("sha256", credential.secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  if (!equal(expected, received)) return null;
  return { provider: "github", deliveryId, eventType: type, rawBody };
}

function decodeGitLabKey(signingToken: string): Buffer | null {
  if (!signingToken.startsWith("whsec_")) return null;
  const encoded = signingToken.slice(6);
  const key = Buffer.from(encoded, "base64");
  return key.byteLength === 32 && key.toString("base64") === encoded ? key : null;
}

function gitlab(
  headers: Readonly<Record<string, string | undefined>>,
  rawBody: string,
  credential: ProviderWebhookCredential,
  nowSeconds: number,
): AuthenticatedProviderWebhook | null {
  const type = header(headers, "x-gitlab-event");
  if (!type || !eventType.test(type)) return null;
  const signed = header(headers, "webhook-signature");
  if (signed) {
    if (credential.kind !== "gitlab_hmac") return null;
    const deliveryId = header(headers, "webhook-id");
    const timestamp = header(headers, "webhook-timestamp");
    const timestampSeconds = Number(timestamp);
    const key = decodeGitLabKey(credential.signingToken);
    if (
      !deliveryId ||
      !identifier.test(deliveryId) ||
      !timestamp ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > maximumClockSkewSeconds ||
      !key
    ) {
      return null;
    }
    const expected = `v1,${createHmac("sha256", key)
      .update(`${deliveryId}.${timestamp}.${rawBody}`, "utf8")
      .digest("base64")}`;
    if (!signed.split(/\s+/u).some((candidate) => equal(expected, candidate))) {
      return null;
    }
    return { provider: "gitlab", deliveryId, eventType: type, rawBody };
  }
  if (credential.kind !== "gitlab_legacy" || credential.secret.length < 32) return null;
  const deliveryId =
    header(headers, "idempotency-key") ?? header(headers, "x-gitlab-webhook-uuid");
  const token = header(headers, "x-gitlab-token");
  if (
    !deliveryId ||
    !identifier.test(deliveryId) ||
    !token ||
    !equal(credential.secret, token)
  ) {
    return null;
  }
  return { provider: "gitlab", deliveryId, eventType: type, rawBody };
}

export function authenticateProviderWebhook(input: {
  readonly provider: SourceProvider;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
  readonly credential: ProviderWebhookCredential;
  readonly nowSeconds: number;
}): AuthenticatedProviderWebhook | null {
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 0) return null;
  const rawBody = bodyText(input.body);
  if (rawBody === null) return null;
  return input.provider === "github"
    ? github(input.headers, rawBody, input.credential)
    : gitlab(input.headers, rawBody, input.credential, input.nowSeconds);
}
