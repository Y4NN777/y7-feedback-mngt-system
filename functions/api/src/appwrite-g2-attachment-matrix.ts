import { createHash } from "node:crypto";

import type { AttachmentSaga } from "./attachment-saga.js";
import type { AttachmentDownload } from "./attachment-download.js";
import {
  appwriteG1SyntheticRows,
  type AppwriteG1MatrixIds,
  type AppwriteG1MatrixSchema,
  type AppwriteG1MatrixTables,
} from "./appwrite-g1-matrix.js";
import type { PublicApi } from "./public-api.js";

export interface AppwriteG2AttachmentSchema extends AppwriteG1MatrixSchema {
  readonly attachmentBucketId: string;
  readonly attachmentStagingTableId: string;
  readonly attachmentsTableId: string;
}

export interface AppwriteG2AttachmentArtifacts extends AppwriteG1MatrixTables {
  getFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<unknown>;
}

export interface AppwriteG2AttachmentStorageCleanup {
  remove(objectId: string): Promise<void>;
}

export interface AppwriteG2AttachmentInput {
  readonly intakeIds: AppwriteG1MatrixIds;
  readonly intakeOperationId: string;
  readonly attachmentOperationId: string;
  readonly attachmentId: string;
  readonly objectId: string;
  readonly stagedAt: string;
}

export interface AppwriteG2AttachmentResult {
  readonly accepted: true;
  readonly privateFile: true;
  readonly metadataEncrypted: true;
  readonly authorizedDownload: true;
  readonly siblingDenied: true;
  readonly removedObject: true;
  readonly cleanedRows: 8;
}

const bytes = new TextEncoder().encode("Y7 attachment evidence\n");

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function derivedId(prefix: "att" | "stg", objectId: string): string {
  return `${prefix}_${createHash("sha256").update(objectId).digest("hex").slice(0, 32)}`;
}

async function acceptFeedback(
  api: PublicApi,
  clientOperationId: string,
): Promise<void> {
  const response = await api.handle({
    method: "POST",
    path: "/v1/projects/wisemoney/feedback",
    headers: { "content-type": "application/json" },
    body: {
      clientOperationId,
      locale: "fr",
      feedback: {
        type: "bug",
        source: { type: "bug", problem: "G2 attachment parent marker" },
        reporter: { kind: "unidentified" },
        context: [],
        attachmentNames: [],
      },
    },
  });
  if (
    response?.statusCode !== 201 ||
    !isObject(response.body) ||
    response.body.status !== "accepted" ||
    response.body.replayed !== false
  ) {
    throw new Error("APPWRITE_G2_ATTACHMENT_PARENT_FAILED");
  }
}

export async function runAppwriteG2AttachmentMatrix(
  api: PublicApi,
  saga: AttachmentSaga,
  download: AttachmentDownload,
  storage: AppwriteG2AttachmentStorageCleanup,
  artifacts: AppwriteG2AttachmentArtifacts,
  schema: AppwriteG2AttachmentSchema,
  input: AppwriteG2AttachmentInput,
): Promise<AppwriteG2AttachmentResult> {
  const feedbackRows = appwriteG1SyntheticRows(
    schema,
    input.intakeIds,
    input.intakeOperationId,
  );
  const rows = [
    ...feedbackRows,
    [schema.attachmentsTableId, input.attachmentId] as const,
  ] as const;
  let failure: unknown;
  let removedObject = false;
  let result:
    Omit<AppwriteG2AttachmentResult, "removedObject" | "cleanedRows"> | undefined;
  try {
    await acceptFeedback(api, input.intakeOperationId);
    const acceptance = await saga.accept({
      operationId: input.attachmentOperationId,
      feedbackId: input.intakeIds.feedbackId,
      workspaceId: "workspace_alpha",
      projectId: "project_alpha",
      audience: "reporter",
      sourceEntry: { kind: "source_submission", id: "source_g2_attachment" },
      files: [
        {
          bytes,
          clientName: "evidence.txt",
          clientMediaType: "text/plain",
        },
      ],
    });
    if (
      acceptance.status !== "accepted" ||
      acceptance.feedbackId !== input.intakeIds.feedbackId ||
      acceptance.attachmentIds.length !== 1 ||
      acceptance.attachmentIds[0] !== input.attachmentId
    ) {
      throw new Error("APPWRITE_G2_ATTACHMENT_ACCEPT_FAILED");
    }

    const [file, staging, metadata] = await Promise.all([
      artifacts.getFile({
        bucketId: schema.attachmentBucketId,
        fileId: derivedId("att", input.objectId),
      }),
      artifacts.getRow({
        databaseId: schema.databaseId,
        tableId: schema.attachmentStagingTableId,
        rowId: derivedId("stg", input.objectId),
      }),
      artifacts.getRow({
        databaseId: schema.databaseId,
        tableId: schema.attachmentsTableId,
        rowId: input.attachmentId,
      }),
    ]);
    if (
      !isObject(file) ||
      !Array.isArray(file.$permissions) ||
      file.$permissions.length !== 0 ||
      !isObject(staging) ||
      staging.objectId !== input.objectId ||
      staging.operationId !== input.attachmentOperationId ||
      typeof staging.stagedAt !== "string" ||
      Date.parse(staging.stagedAt) !== Date.parse(input.stagedAt) ||
      !isObject(metadata) ||
      metadata.objectId !== input.objectId ||
      typeof metadata.displayName !== "string" ||
      !metadata.displayName.startsWith("v1.")
    ) {
      throw new Error("APPWRITE_G2_ATTACHMENT_ARTIFACT_FAILED");
    }

    const authorized = await download(input.attachmentId, {
      kind: "reporter",
      authorizedFeedbackId: input.intakeIds.feedbackId,
    });
    if (
      authorized.status !== "available" ||
      authorized.displayName !== "evidence.txt" ||
      authorized.mediaType !== "text/plain; charset=utf-8" ||
      !Buffer.from(authorized.bytes).equals(Buffer.from(bytes))
    ) {
      throw new Error("APPWRITE_G2_ATTACHMENT_DOWNLOAD_FAILED");
    }
    const sibling = await download(input.attachmentId, {
      kind: "reporter",
      authorizedFeedbackId: "sibling_feedback",
    });
    if (sibling.status !== "denied") {
      throw new Error("APPWRITE_G2_ATTACHMENT_DENIAL_FAILED");
    }
    result = {
      accepted: true,
      privateFile: true,
      metadataEncrypted: true,
      authorizedDownload: true,
      siblingDenied: true,
    };
  } catch (error: unknown) {
    failure = error;
  }

  let cleanupFailure: unknown;
  try {
    await storage.remove(input.objectId);
    removedObject = true;
  } catch (error: unknown) {
    cleanupFailure = error;
  }
  let cleanedRows = 0;
  for (const [tableId, rowId] of [...rows].reverse()) {
    try {
      await artifacts.deleteRow({ databaseId: schema.databaseId, tableId, rowId });
      cleanedRows += 1;
    } catch (error: unknown) {
      if (!absent(error) && cleanupFailure === undefined) cleanupFailure = error;
    }
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("APPWRITE_G2_ATTACHMENT_CLEANUP_FAILED");
  }
  if (failure !== undefined || !removedObject || cleanedRows !== 8) {
    throw new Error("APPWRITE_G2_ATTACHMENT_MATRIX_FAILED", { cause: failure });
  }
  return {
    ...result,
    removedObject: true,
    cleanedRows: 8,
  } as AppwriteG2AttachmentResult;
}
