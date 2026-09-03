export type RecoveryEnvironment = "preview" | "production";
export type RecoveryEntryKind =
  "config" | "deletion_event" | "private_file" | "table_row";

export interface RecoveryEntry {
  readonly kind: RecoveryEntryKind;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface RecoveryInventoryItem {
  readonly kind: RecoveryEntryKind;
  readonly path: string;
  readonly byteLength: number;
  readonly digest: string;
}

export interface RecoveryManifest {
  readonly version: 1;
  readonly recoverySetId: string;
  readonly sourceEnvironment: RecoveryEnvironment;
  readonly snapshotStartedAt: string;
  readonly snapshotCompletedAt: string;
  readonly expiresAt: string;
  readonly encryptionKeyId: string;
  readonly signingKeyId: string;
  readonly counts: Readonly<Record<RecoveryEntryKind, number>>;
  readonly totalBytes: number;
  readonly inventory: readonly RecoveryInventoryItem[];
}

export type RecoveryDigest = (value: Uint8Array) => string;

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,512}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const retentionMilliseconds = 30 * 24 * 60 * 60 * 1_000;

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith("Z") ? parsed : undefined;
}

function inventory(entries: readonly RecoveryEntry[], digest: RecoveryDigest) {
  const paths = new Set<string>();
  const result = entries.map((entry): RecoveryInventoryItem => {
    if (!safePath.test(entry.path) || paths.has(entry.path))
      throw new Error("RECOVERY_INVENTORY_INVALID");
    paths.add(entry.path);
    const entryDigest = digest(entry.bytes);
    if (!digestPattern.test(entryDigest)) throw new Error("RECOVERY_DIGEST_INVALID");
    return {
      kind: entry.kind,
      path: entry.path,
      byteLength: entry.bytes.byteLength,
      digest: entryDigest,
    };
  });
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildRecoveryManifest(input: {
  readonly recoverySetId: string;
  readonly sourceEnvironment: RecoveryEnvironment;
  readonly snapshotStartedAt: string;
  readonly snapshotCompletedAt: string;
  readonly encryptionKeyId: string;
  readonly signingKeyId: string;
  readonly entries: readonly RecoveryEntry[];
  readonly digest: RecoveryDigest;
}): RecoveryManifest {
  const startedAt = instant(input.snapshotStartedAt);
  const completedAt = instant(input.snapshotCompletedAt);
  if (
    !identifier.test(input.recoverySetId) ||
    !identifier.test(input.encryptionKeyId) ||
    !identifier.test(input.signingKeyId) ||
    startedAt === undefined ||
    completedAt === undefined ||
    completedAt < startedAt ||
    input.entries.length === 0
  )
    throw new Error("RECOVERY_MANIFEST_INVALID");
  const items = inventory(input.entries, input.digest);
  const counts: Record<RecoveryEntryKind, number> = {
    config: 0,
    deletion_event: 0,
    private_file: 0,
    table_row: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return {
    version: 1,
    recoverySetId: input.recoverySetId,
    sourceEnvironment: input.sourceEnvironment,
    snapshotStartedAt: input.snapshotStartedAt,
    snapshotCompletedAt: input.snapshotCompletedAt,
    expiresAt: new Date(completedAt + retentionMilliseconds).toISOString(),
    encryptionKeyId: input.encryptionKeyId,
    signingKeyId: input.signingKeyId,
    counts,
    totalBytes: items.reduce((sum, item) => sum + item.byteLength, 0),
    inventory: items,
  };
}

export function validateRecoveryManifest(
  manifest: RecoveryManifest,
  entries: readonly RecoveryEntry[],
  digest: RecoveryDigest,
):
  | { readonly status: "valid" }
  | {
      readonly status: "invalid";
      readonly reason: "digest_mismatch" | "inventory_mismatch";
    } {
  let actual: readonly RecoveryInventoryItem[];
  try {
    actual = inventory(entries, digest);
  } catch {
    return { status: "invalid", reason: "inventory_mismatch" };
  }
  if (actual.length !== manifest.inventory.length)
    return { status: "invalid", reason: "inventory_mismatch" };
  for (const [index, item] of actual.entries()) {
    const expected = manifest.inventory[index];
    if (
      expected === undefined ||
      item.path !== expected.path ||
      item.kind !== expected.kind ||
      item.byteLength !== expected.byteLength
    )
      return { status: "invalid", reason: "inventory_mismatch" };
    if (item.digest !== expected.digest)
      return { status: "invalid", reason: "digest_mismatch" };
  }
  return { status: "valid" };
}

export interface RecoveryDeletionEvent {
  readonly eventId: string;
  readonly feedbackId: string;
  readonly type: "deletion_requested" | "feedback_restored" | "feedback_purged";
  readonly occurredAt: string;
}

export function planDeletionReplay(
  recoveredFeedbackIds: readonly string[],
  events: readonly RecoveryDeletionEvent[],
) {
  const eventIds = new Set<string>();
  const states = new Map<string, "hidden" | "purged" | "visible">();
  const appliedEventIds: string[] = [];
  const ordered = [...events].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.eventId.localeCompare(right.eventId),
  );
  for (const event of ordered) {
    if (
      eventIds.has(event.eventId) ||
      !identifier.test(event.eventId) ||
      !identifier.test(event.feedbackId) ||
      instant(event.occurredAt) === undefined
    )
      continue;
    eventIds.add(event.eventId);
    appliedEventIds.push(event.eventId);
    states.set(
      event.feedbackId,
      event.type === "feedback_purged"
        ? "purged"
        : event.type === "deletion_requested"
          ? "hidden"
          : "visible",
    );
  }
  const recovered = new Set(recoveredFeedbackIds);
  const select = (state: "hidden" | "purged" | "visible") =>
    [...recovered]
      .filter((feedbackId) => (states.get(feedbackId) ?? "visible") === state)
      .sort();
  return {
    visibleFeedbackIds: select("visible"),
    hiddenFeedbackIds: select("hidden"),
    purgeFeedbackIds: select("purged"),
    appliedEventIds,
  };
}

export interface RecoveryExerciseInput {
  readonly backupCompletedAt: string;
  readonly latestSourceMutationAt: string;
  readonly restoreStartedAt: string;
  readonly restoreCompletedAt: string;
  readonly deletionReplayCompletedAt: string;
  readonly exposedAt: string;
  readonly isolated: boolean;
  readonly privateFilesVerified: boolean;
  readonly applicationDataVerified: boolean;
  readonly deletedContentUnavailable: boolean;
  readonly destroyed: boolean;
}

export function evaluateRecoveryExercise(input: RecoveryExerciseInput):
  | {
      readonly status: "passed";
      readonly rpoSeconds: number;
      readonly rtoSeconds: number;
    }
  | { readonly status: "failed"; readonly reason: string } {
  const backup = instant(input.backupCompletedAt);
  const mutation = instant(input.latestSourceMutationAt);
  const started = instant(input.restoreStartedAt);
  const completed = instant(input.restoreCompletedAt);
  const deletionReplay = instant(input.deletionReplayCompletedAt);
  const exposed = instant(input.exposedAt);
  if (
    backup === undefined ||
    mutation === undefined ||
    started === undefined ||
    completed === undefined ||
    deletionReplay === undefined ||
    exposed === undefined
  )
    return { status: "failed", reason: "invalid_timeline" };
  if (deletionReplay > exposed)
    return { status: "failed", reason: "deletion_replay_after_exposure" };
  if (!input.isolated) return { status: "failed", reason: "target_not_isolated" };
  if (!input.applicationDataVerified || !input.privateFilesVerified)
    return { status: "failed", reason: "restore_incomplete" };
  if (!input.deletedContentUnavailable)
    return { status: "failed", reason: "deleted_content_exposed" };
  if (!input.destroyed)
    return { status: "failed", reason: "isolated_target_not_destroyed" };
  const rpoSeconds = Math.floor((backup - mutation) / 1_000);
  const rtoSeconds = Math.floor((completed - started) / 1_000);
  if (rpoSeconds < 0 || rpoSeconds > 24 * 60 * 60)
    return { status: "failed", reason: "rpo_exceeded" };
  if (rtoSeconds < 0 || rtoSeconds > 4 * 60 * 60)
    return { status: "failed", reason: "rto_exceeded" };
  return { status: "passed", rpoSeconds, rtoSeconds };
}
