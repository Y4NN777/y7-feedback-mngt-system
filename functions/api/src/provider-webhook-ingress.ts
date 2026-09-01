import { createHash } from "node:crypto";

import type { SourceProvider } from "@y7-feedback/domain";

import {
  authenticateProviderWebhook,
  type ProviderWebhookCredential,
} from "./provider-webhook-auth.js";

export interface ProviderWebhookAuthority {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly credential: ProviderWebhookCredential;
  readonly active: boolean;
}

export interface ProviderWebhookAuthorityStore {
  resolve(input: {
    readonly provider: SourceProvider;
    readonly connectionId: string;
  }): Promise<ProviderWebhookAuthority | null>;
}

export interface ProviderEventInboxStore {
  accept(input: {
    readonly provider: SourceProvider;
    readonly deliveryId: string;
    readonly eventType: string;
    readonly connectionId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly repositoryId: string;
    readonly payload: string;
    readonly payloadDigest: string;
    readonly receivedAt: string;
  }): Promise<"accepted" | "duplicate">;
}

export type ProviderWebhookIngressResult =
  | { readonly status: "accepted" | "duplicate" }
  | { readonly status: "denied" | "invalid" | "retryable" };

export interface ProviderWebhookIngressDependencies {
  readonly authorities: ProviderWebhookAuthorityStore;
  readonly inbox: ProviderEventInboxStore;
  readonly now: () => Date;
}

const connectionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const repositoryId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerRepositoryId(
  provider: SourceProvider,
  payload: unknown,
): string | null {
  if (!object(payload)) return null;
  const candidate =
    provider === "github"
      ? object(payload.repository)
        ? payload.repository.id
        : undefined
      : object(payload.project)
        ? payload.project.id
        : payload.project_id;
  if (
    (typeof candidate !== "string" && typeof candidate !== "number") ||
    (typeof candidate === "number" && !Number.isSafeInteger(candidate))
  ) {
    return null;
  }
  const normalized = String(candidate);
  return repositoryId.test(normalized) ? normalized : null;
}

function iso(date: Date): string | null {
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createProviderWebhookIngress(
  dependencies: ProviderWebhookIngressDependencies,
): {
  readonly accept: (input: {
    readonly provider: SourceProvider;
    readonly connectionId: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: Uint8Array;
  }) => Promise<ProviderWebhookIngressResult>;
} {
  return {
    async accept(input) {
      if (!connectionId.test(input.connectionId)) return { status: "invalid" };
      let authority: ProviderWebhookAuthority | null;
      try {
        authority = await dependencies.authorities.resolve({
          provider: input.provider,
          connectionId: input.connectionId,
        });
      } catch {
        return { status: "retryable" };
      }
      if (
        !authority ||
        !authority.active ||
        authority.connectionId !== input.connectionId ||
        !connectionId.test(authority.connectionId) ||
        !connectionId.test(authority.workspaceId) ||
        !connectionId.test(authority.projectId) ||
        !repositoryId.test(authority.repositoryId)
      ) {
        return { status: "denied" };
      }
      const received = dependencies.now();
      const receivedAt = iso(received);
      if (!receivedAt) return { status: "retryable" };
      const authenticated = authenticateProviderWebhook({
        provider: input.provider,
        headers: input.headers,
        body: input.body,
        credential: authority.credential,
        nowSeconds: Math.floor(received.getTime() / 1_000),
      });
      if (!authenticated) return { status: "denied" };
      let payload: unknown;
      try {
        payload = JSON.parse(authenticated.rawBody) as unknown;
      } catch {
        return { status: "invalid" };
      }
      if (providerRepositoryId(input.provider, payload) !== authority.repositoryId) {
        return { status: "denied" };
      }
      try {
        const result = await dependencies.inbox.accept({
          provider: input.provider,
          deliveryId: authenticated.deliveryId,
          eventType: authenticated.eventType,
          connectionId: authority.connectionId,
          workspaceId: authority.workspaceId,
          projectId: authority.projectId,
          repositoryId: authority.repositoryId,
          payload: authenticated.rawBody,
          payloadDigest: createHash("sha256")
            .update(authenticated.rawBody, "utf8")
            .digest("base64url"),
          receivedAt,
        });
        return { status: result };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}
