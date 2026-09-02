import type { ApplicationEnvironment } from "@y7-feedback/config/public";

import type { DraftFields, OfflineIntakePersistence } from "./FeedbackIntake";
import type { OfflineOperationInput, OfflineScope } from "./OfflineStore";

interface OfflineIntakeStore {
  loadDraft(
    scope: OfflineScope,
    id: string,
  ): Promise<{ readonly payload: Readonly<Record<string, unknown>> } | null>;
  saveDraft(
    scope: OfflineScope,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  deleteDraft(scope: OfflineScope, id: string): Promise<void>;
  enqueue(scope: OfflineScope, operation: OfflineOperationInput): Promise<unknown>;
}

const fields = [
  "appreciation",
  "contact",
  "expected",
  "experience",
  "observed",
  "problem",
  "proposal",
  "rationale",
  "reproduction",
  "type",
  "usageContext",
  "version",
] as const satisfies readonly (keyof DraftFields)[];

function draft(value: Readonly<Record<string, unknown>>): DraftFields | null {
  if (
    fields.some((field) => {
      const candidate = value[field];
      return typeof candidate !== "string" || candidate.length > 5_000;
    }) ||
    (value.type !== "bug" && value.type !== "suggestion" && value.type !== "review")
  )
    return null;
  return Object.fromEntries(
    fields.map((field) => [field, value[field]]),
  ) as unknown as DraftFields;
}

export function offlineIntakeScope(
  environment: ApplicationEnvironment,
  projectSlug: string,
): OfflineScope {
  return {
    environment,
    workspaceId: "public_projection",
    projectId: projectSlug,
    actorId: "accountless_reporter",
  };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  const encoded = btoa(String.fromCharCode(...new Uint8Array(result)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `sha256_${encoded}`;
}

export function createOfflineIntakePersistence(
  store: OfflineIntakeStore,
  environment: ApplicationEnvironment,
): OfflineIntakePersistence {
  return {
    async restore(projectSlug) {
      const record = await store.loadDraft(
        offlineIntakeScope(environment, projectSlug),
        "intake",
      );
      return record ? draft(record.payload) : null;
    },
    async save(projectSlug, value) {
      await store.saveDraft(offlineIntakeScope(environment, projectSlug), "intake", {
        ...value,
      });
    },
    async clear(projectSlug) {
      await store.deleteDraft(offlineIntakeScope(environment, projectSlug), "intake");
    },
    async queue(command) {
      await store.enqueue(offlineIntakeScope(environment, command.projectSlug), {
        clientOperationId: command.clientOperationId,
        kind: "intake",
        payloadDigest: await digest(command),
        payload: { command },
        dependencies: [],
      });
    },
  };
}
