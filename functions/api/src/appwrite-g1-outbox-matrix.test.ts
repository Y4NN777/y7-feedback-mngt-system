import { describe, expect, it, vi } from "vitest";

import {
  runAppwriteG1OutboxMatrix,
  type AppwriteG1OutboxWorker,
} from "./appwrite-g1-outbox-matrix";
import type { AppwriteG1MatrixTables } from "./appwrite-g1-matrix";
import type { OutboxRunResult } from "./outbox";
import type { PublicApi, PublicApiResponse } from "./public-api";

const schema = {
  databaseId: "feedback",
  reportersTableId: "reporters",
  feedbackTableId: "feedback_items",
  lifecycleTableId: "feedback_lifecycle",
  accessGrantsTableId: "access_grants",
  notificationsTableId: "notifications",
  outboxTableId: "notification_outbox",
  idempotencyTableId: "intake_idempotency",
};
const input = {
  retryIds: {
    feedbackId: "g1f_retry",
    reporterId: "g1r_retry",
    notificationId: "g1n_retry",
    lifecycleId: "g1l_retry",
    outboxId: "g1o_retry",
  },
  permanentIds: {
    feedbackId: "g1f_permanent",
    reporterId: "g1r_permanent",
    notificationId: "g1n_permanent",
    lifecycleId: "g1l_permanent",
    outboxId: "g1o_permanent",
  },
  retryOperationId: "123e4567-e89b-42d3-a456-426614174001",
  permanentOperationId: "123e4567-e89b-42d3-a456-426614174002",
};

function setup(
  responses: readonly PublicApiResponse[] = [
    { statusCode: 201, body: { status: "accepted", replayed: false } },
    { statusCode: 201, body: { status: "accepted", replayed: false } },
  ],
) {
  const handle = vi.fn(() =>
    Promise.resolve(responses[handle.mock.calls.length - 1] ?? null),
  );
  const runs: readonly OutboxRunResult[] = [
    { status: "retry_scheduled", attempt: 1 } as const,
    { status: "delivered", attempt: 2 } as const,
    { status: "failed", attempt: 1 } as const,
    { status: "idle" } as const,
  ];
  let runIndex = 0;
  const runOnce = vi.fn<AppwriteG1OutboxWorker["runOnce"]>(() =>
    Promise.resolve(runs[runIndex++] ?? { status: "idle" }),
  );
  const getRow = vi
    .fn<AppwriteG1MatrixTables["getRow"]>()
    .mockResolvedValueOnce({ status: "delivered", payloadJson: "v1.envelope" })
    .mockResolvedValueOnce({ status: "failed", payloadJson: "v1.envelope" });
  const deleteRow = vi.fn<AppwriteG1MatrixTables["deleteRow"]>(() =>
    Promise.resolve({}),
  );
  return {
    api: { handle } satisfies PublicApi,
    deleteRow,
    getRow,
    tables: { getRow, deleteRow } satisfies AppwriteG1MatrixTables,
    worker: { runOnce } satisfies AppwriteG1OutboxWorker,
  };
}

describe("real Appwrite G1 outbox matrix", () => {
  it("BDD-G1-REAL-011 proves retry, recovery, permanent failure, and deduplication", async () => {
    const target = setup();
    await expect(
      runAppwriteG1OutboxMatrix(
        target.api,
        target.worker,
        target.tables,
        schema,
        input,
      ),
    ).resolves.toEqual({
      retryScheduled: true,
      retryDelivered: true,
      permanentFailed: true,
      deduplicated: true,
      terminalRowsEncrypted: true,
      cleanedRows: 14,
    });
    expect(target.worker.runOnce).toHaveBeenCalledTimes(4);
    expect(target.deleteRow).toHaveBeenCalledTimes(14);
  });

  it("BDD-G1-REAL-012 fails closed for inconsistent acceptance and delivery", async () => {
    for (const responses of [
      [{ statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } }],
      [
        { statusCode: 201, body: { status: "accepted", replayed: false } },
        { statusCode: 201, body: { status: "wrong", replayed: false } },
      ],
    ] satisfies readonly (readonly PublicApiResponse[])[]) {
      const target = setup(responses);
      await expect(
        runAppwriteG1OutboxMatrix(
          target.api,
          target.worker,
          target.tables,
          schema,
          input,
        ),
      ).rejects.toThrow(/^APPWRITE_G1_OUTBOX_[A-Z_]+_FAILED$/u);
    }

    for (const wrongRun of [0, 1, 2, 3]) {
      const target = setup();
      vi.mocked(target.worker.runOnce).mockImplementation(() => {
        const index = target.worker.runOnce.mock.calls.length - 1;
        if (index === wrongRun) {
          return Promise.resolve(
            index === 3 ? { status: "delivered", attempt: 4 } : { status: "idle" },
          );
        }
        const expected: readonly OutboxRunResult[] = [
          { status: "retry_scheduled", attempt: 1 },
          { status: "delivered", attempt: 2 },
          { status: "failed", attempt: 1 },
          { status: "idle" },
        ];
        return Promise.resolve(expected[index] ?? { status: "idle" });
      });
      await expect(
        runAppwriteG1OutboxMatrix(
          target.api,
          target.worker,
          target.tables,
          schema,
          input,
        ),
      ).rejects.toThrow(/^APPWRITE_G1_OUTBOX_[A-Z_]+_FAILED$/u);
    }
  });

  it("BDD-G1-REAL-013 rejects unsafe terminal rows and cleanup failures", async () => {
    for (const rows of [
      [null, { status: "failed", payloadJson: "v1.envelope" }],
      [
        { status: "wrong", payloadJson: "v1.envelope" },
        { status: "failed", payloadJson: "v1.envelope" },
      ],
      [
        { status: "delivered", payloadJson: "plain" },
        { status: "failed", payloadJson: "v1.envelope" },
      ],
      [
        { status: "delivered", payloadJson: "v1.envelope" },
        { status: "wrong", payloadJson: "v1.envelope" },
      ],
      [
        { status: "delivered", payloadJson: "v1.envelope" },
        { status: "failed", payloadJson: "plain" },
      ],
    ] as const) {
      const target = setup();
      vi.mocked(target.getRow).mockReset();
      target.getRow.mockResolvedValueOnce(rows[0]).mockResolvedValueOnce(rows[1]);
      await expect(
        runAppwriteG1OutboxMatrix(
          target.api,
          target.worker,
          target.tables,
          schema,
          input,
        ),
      ).rejects.toThrow(/^APPWRITE_G1_OUTBOX_[A-Z_]+_FAILED$/u);
    }

    const cleanup = setup();
    cleanup.deleteRow.mockRejectedValueOnce("cleanup failed");
    await expect(
      runAppwriteG1OutboxMatrix(
        cleanup.api,
        cleanup.worker,
        cleanup.tables,
        schema,
        input,
      ),
    ).rejects.toThrow("APPWRITE_G1_OUTBOX_CLEANUP_FAILED");

    const cleanupError = setup();
    cleanupError.deleteRow.mockRejectedValueOnce(new Error("cleanup error"));
    await expect(
      runAppwriteG1OutboxMatrix(
        cleanupError.api,
        cleanupError.worker,
        cleanupError.tables,
        schema,
        input,
      ),
    ).rejects.toThrow("cleanup error");

    const missing = setup();
    missing.deleteRow.mockRejectedValue({ code: 404 });
    await expect(
      runAppwriteG1OutboxMatrix(
        missing.api,
        missing.worker,
        missing.tables,
        schema,
        input,
      ),
    ).rejects.toThrow(/^APPWRITE_G1_OUTBOX_[A-Z_]+_FAILED$/u);
  });
});
