import { describe, expect, it } from "vitest";

import { recoveryDeletionFixtures } from "./recovery-g5-fixtures";

describe("Recovery G5 fixtures", () => {
  it("BDD-REC-302 emits deletion events accepted by the restore contract", () => {
    expect(recoveryDeletionFixtures("2026-09-10T18:00:00.000Z")).toEqual([
      {
        rowId: "event_deleted",
        data: {
          eventId: "event_deleted",
          feedbackId: "feedback_deleted",
          type: "deletion_requested",
          occurredAt: "2026-09-10T18:00:00.000Z",
        },
      },
      {
        rowId: "event_purged",
        data: {
          eventId: "event_purged",
          feedbackId: "feedback_purged",
          type: "feedback_purged",
          occurredAt: "2026-09-10T18:00:00.000Z",
        },
      },
    ]);
  });

  it("BDD-REC-303 rejects a non-UTC fixture time", () => {
    expect(() => recoveryDeletionFixtures("invalid")).toThrow(
      "RECOVERY_G5_FIXTURE_TIME_INVALID",
    );
  });
});
