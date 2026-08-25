import { createHash } from "node:crypto";

import { createAttachmentRecord } from "@y7-feedback/domain";

import type {
  AttachmentAcceptanceStore,
  AttachmentSaga,
  PrivateAttachmentStorage,
} from "./attachment-saga.js";

export interface AppwriteG2SweeperSchema {
  readonly databaseId: string;
  readonly attachmentBucketId: string;
  readonly attachmentStagingTableId: string;
  readonly attachmentsTableId: string;
}

export interface AppwriteG2SweeperArtifacts {
  getFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<unknown>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AppwriteG2SweeperInput {
  readonly operationId: string;
  readonly attachmentId: string;
  readonly associatedObjectId: string;
  readonly orphanObjectId: string;
  readonly stagedAt: string;
  readonly sweepBefore: string;
}

export interface AppwriteG2SweeperResult {
  readonly isolatedSelection: true;
  readonly orphanRemoved: true;
  readonly associatedRetained: true;
  readonly privateFile: true;
  readonly cleanedRows: 1;
}

const bytes = new TextEncoder().encode("Y7 sweeper evidence\n");

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function derivedId(prefix: "att" | "stg", objectId: string): string {
  return `${prefix}_${createHash("sha256").update(objectId).digest("hex").slice(0, 32)}`;
}

async function isAbsent(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch (error: unknown) {
    if (absent(error)) return true;
    throw error;
  }
}

export async function runAppwriteG2SweeperMatrix(
  saga: AttachmentSaga,
  storage: PrivateAttachmentStorage,
  store: AttachmentAcceptanceStore,
  artifacts: AppwriteG2SweeperArtifacts,
  schema: AppwriteG2SweeperSchema,
  input: AppwriteG2SweeperInput,
): Promise<AppwriteG2SweeperResult> {
  let failure: unknown;
  try {
    await storage.stage({
      objectId: input.associatedObjectId,
      operationId: input.operationId,
      stagedAt: input.stagedAt,
      bytes,
      visibility: "private",
    });
    await storage.stage({
      objectId: input.orphanObjectId,
      operationId: input.operationId,
      stagedAt: input.stagedAt,
      bytes,
      visibility: "private",
    });
    await store.commit({
      operationId: input.operationId,
      feedbackId: `g2sf_${input.attachmentId}`,
      attachments: [
        createAttachmentRecord({
          id: input.attachmentId,
          objectId: input.associatedObjectId,
          feedbackId: `g2sf_${input.attachmentId}`,
          workspaceId: "workspace_alpha",
          projectId: "project_alpha",
          audience: "reporter",
          sourceEntry: { kind: "source_submission", id: "source_g2_sweeper" },
          displayName: "sweeper-evidence.txt",
          mediaType: "text/plain; charset=utf-8",
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("base64url"),
          createdAt: input.stagedAt,
        }),
      ],
    });

    const selected = await storage.listStagedBefore(input.sweepBefore);
    const selectedIds = selected.map(({ objectId }) => objectId).sort();
    const expectedIds = [input.associatedObjectId, input.orphanObjectId].sort();
    if (
      selectedIds.length !== 2 ||
      selectedIds.some((objectId, index) => objectId !== expectedIds[index])
    ) {
      throw new Error("APPWRITE_G2_SWEEPER_SELECTION_UNSAFE");
    }

    const sweep = await saga.sweep(input.sweepBefore);
    if (
      sweep.status !== "completed" ||
      sweep.examined !== 2 ||
      sweep.removed !== 1 ||
      sweep.retained !== 1 ||
      sweep.failed !== 0
    ) {
      throw new Error("APPWRITE_G2_SWEEPER_OUTCOME_INVALID");
    }

    const [associated, orphan, file, associatedStaging, orphanStaging, metadata] =
      await Promise.all([
        store.isObjectAssociated(input.associatedObjectId),
        store.isObjectAssociated(input.orphanObjectId),
        artifacts.getFile({
          bucketId: schema.attachmentBucketId,
          fileId: derivedId("att", input.associatedObjectId),
        }),
        artifacts.getRow({
          databaseId: schema.databaseId,
          tableId: schema.attachmentStagingTableId,
          rowId: derivedId("stg", input.associatedObjectId),
        }),
        isAbsent(() =>
          artifacts.getRow({
            databaseId: schema.databaseId,
            tableId: schema.attachmentStagingTableId,
            rowId: derivedId("stg", input.orphanObjectId),
          }),
        ),
        artifacts.getRow({
          databaseId: schema.databaseId,
          tableId: schema.attachmentsTableId,
          rowId: input.attachmentId,
        }),
      ]);
    const orphanFile = await isAbsent(() =>
      artifacts.getFile({
        bucketId: schema.attachmentBucketId,
        fileId: derivedId("att", input.orphanObjectId),
      }),
    );
    if (
      !associated ||
      orphan ||
      !isObject(file) ||
      !Array.isArray(file.$permissions) ||
      file.$permissions.length !== 0 ||
      !isObject(associatedStaging) ||
      associatedStaging.objectId !== input.associatedObjectId ||
      !orphanStaging ||
      !orphanFile ||
      !isObject(metadata) ||
      metadata.objectId !== input.associatedObjectId
    ) {
      throw new Error("APPWRITE_G2_SWEEPER_ARTIFACT_INVALID");
    }
  } catch (error: unknown) {
    failure = error;
  }

  let cleanupFailure: unknown;
  for (const objectId of [input.associatedObjectId, input.orphanObjectId]) {
    try {
      await storage.remove(objectId);
    } catch (error: unknown) {
      cleanupFailure ??= error;
    }
  }
  let cleanedRows = 0;
  try {
    await artifacts.deleteRow({
      databaseId: schema.databaseId,
      tableId: schema.attachmentsTableId,
      rowId: input.attachmentId,
    });
    cleanedRows = 1;
  } catch (error: unknown) {
    if (!absent(error)) cleanupFailure ??= error;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("APPWRITE_G2_SWEEPER_CLEANUP_FAILED");
  }
  if (failure !== undefined || cleanedRows !== 1) {
    throw new Error("APPWRITE_G2_SWEEPER_MATRIX_FAILED", { cause: failure });
  }
  return {
    isolatedSelection: true,
    orphanRemoved: true,
    associatedRetained: true,
    privateFile: true,
    cleanedRows: 1,
  };
}
