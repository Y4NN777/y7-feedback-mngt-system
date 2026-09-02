import { createHash } from "node:crypto";

import type { ProviderMessageAdapter } from "./provider-message.js";
import type { ProviderMessageReconciliationReader } from "./appwrite-provider-message-reconciliation-reader.js";
import type {
  ProviderMessageAuthorVerifier,
  ProviderMessageContextResolver,
  ProviderMessageFactStore,
} from "./provider-message-event.js";

export function createProviderMessageReconciliation(dependencies: {
  readonly reader: ProviderMessageReconciliationReader;
  readonly contexts: ProviderMessageContextResolver;
  readonly authors: ProviderMessageAuthorVerifier;
  readonly facts: ProviderMessageFactStore;
  readonly providers: readonly ProviderMessageAdapter[];
  readonly now: () => string;
}) {
  const providers = new Map(
    dependencies.providers.map((item) => [item.provider, item]),
  );
  if (providers.size !== 2 || !providers.has("github") || !providers.has("gitlab"))
    throw new Error("PROVIDER_MESSAGE_RECONCILIATION_CONFIG_INVALID");
  const eventId = (...parts: readonly string[]) =>
    `rec_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 31)}`;
  return {
    async runOnce(): Promise<Readonly<Record<string, unknown>>> {
      const candidates = await dependencies.reader.list();
      let revised = 0;
      let tombstoned = 0;
      let unchanged = 0;
      let denied = 0;
      for (const { observation } of candidates) {
        const resolved = await dependencies.contexts.resolve(observation);
        if (resolved.status === "ignored" || resolved.status === "permanent") {
          unchanged += 1;
          continue;
        }
        if (resolved.status === "retryable")
          throw new Error("PROVIDER_MESSAGE_RECONCILIATION_RETRYABLE");
        const adapter = providers.get(observation.provider);
        if (!adapter) throw new Error("PROVIDER_MESSAGE_RECONCILIATION_CONFIG_INVALID");
        const inspected = await adapter.inspect({
          encryptedGrantRef: resolved.context.encryptedGrantRef,
          repository: {
            id: resolved.context.repositoryId,
            owner: resolved.context.repositoryOwner,
            name: resolved.context.repositoryName,
          },
          issueId: resolved.context.issueId,
          commentId: resolved.context.commentId,
        });
        if (inspected.status === "missing") {
          const now = dependencies.now();
          const outcome = await dependencies.facts.apply({
            ...resolved.context,
            mutation: "tombstoned",
            content: undefined,
            deliveryId: eventId(
              "missing",
              observation.provider,
              observation.repositoryId,
              observation.commentId,
              now,
            ),
            providerUpdatedAt: now,
          });
          if (outcome === "applied") tombstoned += 1;
          else unchanged += 1;
          continue;
        }
        if (inspected.updatedAt <= observation.providerUpdatedAt) {
          unchanged += 1;
          continue;
        }
        const revision = {
          ...resolved.context,
          mutation: "revised" as const,
          content: inspected.content,
          authorId: inspected.authorId,
          authorLogin: inspected.authorLogin,
          deliveryId: eventId(
            "revision",
            observation.provider,
            observation.repositoryId,
            observation.commentId,
            inspected.updatedAt,
          ),
          providerUpdatedAt: inspected.updatedAt,
        };
        const authority = await dependencies.authors.verify(revision);
        if (authority === "retryable")
          throw new Error("PROVIDER_MESSAGE_RECONCILIATION_RETRYABLE");
        if (authority === "denied") {
          denied += 1;
          continue;
        }
        const outcome = await dependencies.facts.apply(revision);
        if (outcome === "applied") revised += 1;
        else unchanged += 1;
      }
      return {
        status: "reconciled",
        inspected: candidates.length,
        revised,
        tombstoned,
        unchanged,
        denied,
      };
    },
  };
}
