import {
  createAttachmentRecord,
  type AttachmentAudience,
  type AttachmentRecord,
  type AttachmentSourceEntry,
} from "@y7-feedback/domain";

import type {
  AttachmentCandidate,
  AttachmentValidationOutcome,
} from "./attachment-validation.js";

export interface StagedAttachmentObject {
  readonly objectId: string;
  readonly operationId: string;
  readonly stagedAt: string;
}

export interface PrivateAttachmentStorage {
  stage(input: {
    readonly objectId: string;
    readonly operationId: string;
    readonly stagedAt: string;
    readonly bytes: Uint8Array;
    readonly visibility: "private";
  }): Promise<void>;
  remove(objectId: string): Promise<void>;
  listStagedBefore(before: string): Promise<readonly StagedAttachmentObject[]>;
}

export interface AttachmentAcceptanceStore {
  commit(input: {
    readonly operationId: string;
    readonly feedbackId: string;
    readonly attachments: readonly AttachmentRecord[];
  }): Promise<void>;
  isObjectAssociated(objectId: string): Promise<boolean>;
}

export interface AttachmentSagaDependencies {
  readonly now: () => string;
  readonly createAttachmentId: () => string;
  readonly createObjectId: () => string;
  readonly validate: (
    candidate: AttachmentCandidate,
  ) => Promise<AttachmentValidationOutcome>;
}

export interface AttachmentAcceptanceCommand {
  readonly operationId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly audience: AttachmentAudience;
  readonly sourceEntry: AttachmentSourceEntry;
  readonly files: readonly AttachmentCandidate[];
}

export type AttachmentAcceptanceOutcome =
  | {
      readonly status: "accepted";
      readonly feedbackId: string;
      readonly attachmentIds: readonly string[];
    }
  | { readonly status: "rejected"; readonly code: "ATTACHMENT_REJECTED" }
  | { readonly status: "retryable"; readonly code: "ATTACHMENT_UNAVAILABLE" };

export type AttachmentSweepOutcome =
  | {
      readonly status: "completed";
      readonly examined: number;
      readonly removed: number;
      readonly retained: number;
      readonly failed: number;
    }
  | { readonly status: "retryable"; readonly code: "SWEEP_UNAVAILABLE" };

export interface AttachmentSaga {
  accept(command: AttachmentAcceptanceCommand): Promise<AttachmentAcceptanceOutcome>;
  sweep(before: string): Promise<AttachmentSweepOutcome>;
}

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRequired(value: string, maximum = 200): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum;
}

function isValidCommand(command: AttachmentAcceptanceCommand): boolean {
  const expectedAudience =
    command.sourceEntry.kind === "internal_note" ? "workspace" : "reporter";
  return (
    operationIdPattern.test(command.operationId) &&
    isRequired(command.feedbackId) &&
    isRequired(command.workspaceId) &&
    isRequired(command.projectId) &&
    isRequired(command.sourceEntry.id) &&
    command.audience === expectedAudience &&
    command.files.length >= 1 &&
    command.files.length <= 5
  );
}

function unavailable(): AttachmentAcceptanceOutcome {
  return { status: "retryable", code: "ATTACHMENT_UNAVAILABLE" };
}

async function cleanup(
  storage: PrivateAttachmentStorage,
  objectIds: readonly string[],
): Promise<boolean> {
  const results = await Promise.allSettled(
    [...new Set(objectIds)].map((objectId) => storage.remove(objectId)),
  );
  return results.every((result) => result.status === "fulfilled");
}

export function createAttachmentSaga(
  storage: PrivateAttachmentStorage,
  store: AttachmentAcceptanceStore,
  dependencies: AttachmentSagaDependencies,
): AttachmentSaga {
  return {
    async accept(command) {
      if (!isValidCommand(command)) {
        return { status: "rejected", code: "ATTACHMENT_REJECTED" };
      }

      const intendedObjectIds: string[] = [];
      const attachmentIds = new Set<string>();
      const records: AttachmentRecord[] = [];
      let failure: "rejected" | "retryable" | undefined;

      try {
        const stagedAt = dependencies.now();
        for (const candidate of command.files) {
          const attachmentId = dependencies.createAttachmentId().trim();
          const objectId = dependencies.createObjectId().trim();
          if (
            !isRequired(attachmentId) ||
            attachmentIds.has(attachmentId) ||
            !isRequired(objectId, 500) ||
            !objectId.startsWith("private/") ||
            intendedObjectIds.includes(objectId)
          ) {
            throw new Error("invalid attachment dependency");
          }
          attachmentIds.add(attachmentId);
          intendedObjectIds.push(objectId);

          await storage.stage({
            objectId,
            operationId: command.operationId,
            stagedAt,
            bytes: candidate.bytes,
            visibility: "private",
          });
          const validation = await dependencies.validate(candidate);
          if (validation.status !== "accepted") {
            failure = validation.status;
            break;
          }
          records.push(
            createAttachmentRecord({
              id: attachmentId,
              objectId,
              feedbackId: command.feedbackId,
              workspaceId: command.workspaceId,
              projectId: command.projectId,
              audience: command.audience,
              sourceEntry: command.sourceEntry,
              displayName: validation.metadata.displayName,
              mediaType: validation.metadata.mediaType,
              size: validation.metadata.size,
              sha256: validation.metadata.sha256,
              createdAt: stagedAt,
            }),
          );
        }

        if (!failure) {
          await store.commit({
            operationId: command.operationId,
            feedbackId: command.feedbackId,
            attachments: records,
          });
          return {
            status: "accepted",
            feedbackId: command.feedbackId,
            attachmentIds: records.map((record) => record.id),
          };
        }
      } catch {
        failure = "retryable";
      }

      const cleaned = await cleanup(storage, intendedObjectIds);
      if (!cleaned || failure === "retryable") return unavailable();
      return { status: "rejected", code: "ATTACHMENT_REJECTED" };
    },

    async sweep(before) {
      let staged: readonly StagedAttachmentObject[];
      try {
        staged = await storage.listStagedBefore(before);
      } catch {
        return { status: "retryable", code: "SWEEP_UNAVAILABLE" };
      }

      let removed = 0;
      let retained = 0;
      let failed = 0;
      for (const object of staged) {
        try {
          if (await store.isObjectAssociated(object.objectId)) {
            retained += 1;
          } else {
            await storage.remove(object.objectId);
            removed += 1;
          }
        } catch {
          failed += 1;
        }
      }
      return {
        status: "completed",
        examined: staged.length,
        removed,
        retained,
        failed,
      };
    },
  };
}
