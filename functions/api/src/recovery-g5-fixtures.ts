import type { RecoveryDeletionEvent } from "@y7-feedback/domain";

export function recoveryDeletionFixtures(occurredAt: string): readonly {
  readonly rowId: string;
  readonly data: RecoveryDeletionEvent;
}[] {
  if (!occurredAt.endsWith("Z") || !Number.isFinite(Date.parse(occurredAt)))
    throw new Error("RECOVERY_G5_FIXTURE_TIME_INVALID");
  return [
    {
      rowId: "event_deleted",
      data: {
        eventId: "event_deleted",
        feedbackId: "feedback_deleted",
        type: "deletion_requested",
        occurredAt,
      },
    },
    {
      rowId: "event_purged",
      data: {
        eventId: "event_purged",
        feedbackId: "feedback_purged",
        type: "feedback_purged",
        occurredAt,
      },
    },
  ];
}
