import { planDeletionReplay, type RecoveryDeletionEvent } from "@y7-feedback/domain";

import { openRecoveryArtifact, type RecoveryArtifact } from "./recovery-artifact.js";

export interface RecoveryRestoreTarget {
  assertIsolation(): Promise<{ readonly isolated: boolean; readonly exposed: boolean }>;
  restoreConfiguration(configuration: unknown): Promise<void>;
  restoreRow(tableId: string, rowId: string, row: unknown): Promise<void>;
  restorePrivateFile(
    bucketId: string,
    fileId: string,
    bytes: Uint8Array,
  ): Promise<void>;
  hideFeedback(feedbackId: string): Promise<void>;
  purgeFeedback(feedbackId: string): Promise<void>;
  verifyApplicationData(): Promise<boolean>;
  verifyPrivateFiles(): Promise<boolean>;
  verifyDeletedContentUnavailable(): Promise<boolean>;
  expose(): Promise<string>;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("RECOVERY_ENTRY_INVALID");
  }
}

function deletionEvent(value: unknown): RecoveryDeletionEvent {
  if (typeof value !== "object" || value === null)
    throw new Error("RECOVERY_DELETION_EVENT_INVALID");
  const eventId = "eventId" in value ? value.eventId : undefined;
  const feedbackId = "feedbackId" in value ? value.feedbackId : undefined;
  const type = "type" in value ? value.type : undefined;
  const occurredAt = "occurredAt" in value ? value.occurredAt : undefined;
  if (
    typeof eventId !== "string" ||
    typeof feedbackId !== "string" ||
    (type !== "deletion_requested" &&
      type !== "feedback_restored" &&
      type !== "feedback_purged") ||
    typeof occurredAt !== "string"
  )
    throw new Error("RECOVERY_DELETION_EVENT_INVALID");
  return { eventId, feedbackId, type, occurredAt };
}

function segments(path: string, prefix: string, suffix = "") {
  if (!path.startsWith(prefix) || (suffix && !path.endsWith(suffix)))
    throw new Error("RECOVERY_ENTRY_PATH_INVALID");
  const end = suffix ? -suffix.length : undefined;
  const result = path.slice(prefix.length, end).split("/");
  if (result.length !== 2 || result.some((part) => part.length === 0))
    throw new Error("RECOVERY_ENTRY_PATH_INVALID");
  return result as [string, string];
}

export async function restoreRecoveryArtifact(input: {
  readonly artifact: RecoveryArtifact;
  readonly encryptionKey: Uint8Array;
  readonly signingKey: Uint8Array;
  readonly target: RecoveryRestoreTarget;
  readonly feedbackTableId: string;
  readonly now?: () => string;
}): Promise<{
  readonly status: "restored";
  readonly recoverySetId: string;
  readonly rows: number;
  readonly privateFiles: number;
  readonly hidden: number;
  readonly purged: number;
  readonly deletionReplayCompletedAt: string;
  readonly exposedAt: string;
}> {
  const isolation = await input.target.assertIsolation();
  if (!isolation.isolated || isolation.exposed)
    throw new Error("RECOVERY_TARGET_NOT_ISOLATED");
  const opened = openRecoveryArtifact(input);
  const configuration = opened.entries.filter(({ kind }) => kind === "config");
  const configurationEntry = configuration[0];
  if (configuration.length !== 1 || !configurationEntry)
    throw new Error("RECOVERY_CONFIGURATION_INVALID");
  await input.target.restoreConfiguration(parseJson(configurationEntry.bytes));
  const feedbackIds: string[] = [];
  const deletionEvents: RecoveryDeletionEvent[] = [];
  let rows = 0;
  let privateFiles = 0;
  for (const entry of opened.entries) {
    if (entry.kind === "table_row") {
      const [tableId, rowId] = segments(entry.path, "tables/", ".json");
      await input.target.restoreRow(tableId, rowId, parseJson(entry.bytes));
      if (tableId === input.feedbackTableId) feedbackIds.push(rowId);
      rows += 1;
    } else if (entry.kind === "private_file") {
      const [bucketId, fileId] = segments(entry.path, "storage/");
      await input.target.restorePrivateFile(bucketId, fileId, entry.bytes);
      privateFiles += 1;
    } else if (entry.kind === "deletion_event") {
      deletionEvents.push(deletionEvent(parseJson(entry.bytes)));
    }
  }
  const replay = planDeletionReplay(feedbackIds, deletionEvents);
  for (const feedbackId of replay.hiddenFeedbackIds)
    await input.target.hideFeedback(feedbackId);
  for (const feedbackId of replay.purgeFeedbackIds)
    await input.target.purgeFeedback(feedbackId);
  const deletionReplayCompletedAt = (input.now ?? (() => new Date().toISOString()))();
  const [applicationDataVerified, privateFilesVerified, deletedContentUnavailable] =
    await Promise.all([
      input.target.verifyApplicationData(),
      input.target.verifyPrivateFiles(),
      input.target.verifyDeletedContentUnavailable(),
    ]);
  if (!applicationDataVerified || !privateFilesVerified)
    throw new Error("RECOVERY_RESTORE_INCOMPLETE");
  if (!deletedContentUnavailable) throw new Error("RECOVERY_DELETION_REPLAY_FAILED");
  const exposedAt = await input.target.expose();
  return {
    status: "restored",
    recoverySetId: opened.manifest.recoverySetId,
    rows,
    privateFiles,
    hidden: replay.hiddenFeedbackIds.length,
    purged: replay.purgeFeedbackIds.length,
    deletionReplayCompletedAt,
    exposedAt,
  };
}
