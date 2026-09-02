import type { ApplicationEnvironment } from "@y7-feedback/config/public";
import type { ValidatedFeedbackDraft } from "@y7-feedback/domain";

import { offlineIntakeScope } from "./OfflineIntake";
import type {
  IntakeGateway,
  IntakeGatewayCommand,
  IntakeGatewayOutcome,
} from "./IntakeGateway";
import { createOfflineReplay, type OfflineReplayStore } from "./OfflineReplay";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDraft(value: unknown): value is ValidatedFeedbackDraft {
  if (!object(value)) return false;
  return (
    typeof value.projectId === "string" &&
    typeof value.workspaceId === "string" &&
    (value.type === "bug" || value.type === "suggestion" || value.type === "review") &&
    object(value.originalSource) &&
    value.originalSource.type === value.type &&
    object(value.reporter) &&
    typeof value.reporter.kind === "string" &&
    Array.isArray(value.context) &&
    value.context.every(
      (entry) =>
        object(entry) &&
        typeof entry.name === "string" &&
        (typeof entry.value === "string" ||
          typeof entry.value === "number" ||
          typeof entry.value === "boolean") &&
        typeof entry.purpose === "string" &&
        (entry.source === "public" ||
          entry.source === "client_assertion" ||
          entry.source === "system_observed") &&
        (entry.trust === "unverified" || entry.trust === "verified"),
    ) &&
    Array.isArray(value.attachmentNames) &&
    value.attachmentNames.every((name) => typeof name === "string") &&
    value.derivedClassification === null
  );
}

function parseCommand(value: unknown): IntakeGatewayCommand | null {
  if (
    !object(value) ||
    typeof value.projectSlug !== "string" ||
    typeof value.clientOperationId !== "string" ||
    (value.locale !== "fr" && value.locale !== "en") ||
    !validDraft(value.draft)
  )
    return null;
  return {
    projectSlug: value.projectSlug,
    clientOperationId: value.clientOperationId,
    locale: value.locale,
    draft: value.draft,
  };
}

export type OfflineIntakeReplayOutcome =
  | {
      readonly status: "accepted";
      readonly outcome: Extract<IntakeGatewayOutcome, { readonly status: "accepted" }>;
    }
  | {
      readonly status:
        "idle" | "offline" | "waiting" | "dependency_blocked" | "retry_scheduled";
    }
  | { readonly status: "conflict"; readonly operationId: string };

export interface OfflineIntakeReplay {
  runOnce(projectSlug: string): Promise<OfflineIntakeReplayOutcome>;
}

export function createOfflineIntakeReplay(input: {
  readonly store: OfflineReplayStore;
  readonly environment: ApplicationEnvironment;
  readonly gateway: IntakeGateway;
  readonly probe: () => Promise<boolean>;
  readonly now?: () => Date;
}): OfflineIntakeReplay {
  return {
    async runOnce(projectSlug) {
      let accepted:
        Extract<IntakeGatewayOutcome, { readonly status: "accepted" }> | undefined;
      const replay = createOfflineReplay({
        store: input.store,
        probe: input.probe,
        send: async (operation) => {
          const stored = object(operation.payload)
            ? parseCommand(operation.payload.command)
            : null;
          if (!stored || stored.projectSlug !== projectSlug)
            return { status: "conflict" };
          const outcome = await input.gateway.accept(stored);
          if (outcome.status === "accepted") {
            accepted = outcome;
            return { status: "accepted" };
          }
          if (outcome.status !== "retryable") return { status: "conflict" };
          return {
            status: "retryable",
            ...(outcome.retryAfterMs === undefined
              ? {}
              : { retryAfterMs: outcome.retryAfterMs }),
          };
        },
        ...(input.now ? { now: input.now } : {}),
      });
      const result = await replay.runOnce(
        offlineIntakeScope(input.environment, projectSlug),
      );
      if (result.status === "synchronized" && accepted)
        return { status: "accepted", outcome: accepted };
      if (result.status === "synchronized")
        return { status: "conflict", operationId: result.operationId };
      if (result.status === "conflict") return result;
      return { status: result.status };
    },
  };
}
