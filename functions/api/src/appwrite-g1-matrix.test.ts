import { describe, expect, it, vi } from "vitest";

import type { AccountlessAccessCoordinator } from "./accountless-access";
import {
  runAppwriteG1Matrix,
  runAppwriteG1RollbackMatrix,
  type AppwriteG1MatrixTables,
} from "./appwrite-g1-matrix";
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
const ids = {
  feedbackId: "g1f_test",
  reporterId: "g1r_test",
  notificationId: "g1n_test",
  lifecycleId: "g1l_test",
  outboxId: "g1o_test",
};
const operationId = "123e4567-e89b-42d3-a456-426614174000";
const proof = "P".repeat(43);
const rotatedProof = "R".repeat(43);
const reporterView = {
  feedbackId: "g1f_test",
  reference: "Y7-G1-TEST",
  originalSource: { type: "bug" as const, problem: "Problem" },
  currentSource: { type: "bug" as const, problem: "Problem" },
  currentState: "received" as const,
  history: [],
  messages: [],
  attachments: [],
  sourceRevisions: [],
  deletionRequests: [],
};
const protectedRows: readonly unknown[] = [
  { attributionJson: "v1.key.nonce.cipher.tag" },
  {
    originalSourceJson: "v1.key.nonce.cipher.tag",
    currentSourceJson: "v1.key.nonce.cipher.tag",
  },
  { verifier: "v1.key.nonce.cipher.tag" },
  { payloadJson: "v1.key.nonce.cipher.tag" },
  {
    protectedProof: "v1.key.nonce.cipher.tag",
    proofVerifier: "v1.key.nonce.cipher.tag",
  },
];

function setup(
  responses: readonly PublicApiResponse[],
  rows: readonly unknown[] = protectedRows,
  accountlessOverrides: Partial<AccountlessAccessCoordinator> = {},
) {
  const handle = vi.fn(() => {
    const response = responses[handle.mock.calls.length - 1];
    return Promise.resolve(response ?? null);
  });
  const getRow = vi.fn(() => Promise.resolve(rows[getRow.mock.calls.length - 1]));
  const deleteRow = vi.fn(() => Promise.resolve({}));
  const accountless: AccountlessAccessCoordinator = {
    rotate: () =>
      Promise.resolve({
        status: "ok",
        reference: "Y7-G1-TEST",
        accessProof: rotatedProof,
      }),
    retrieve: vi
      .fn()
      .mockResolvedValueOnce({ status: "denied", code: "ACCESS_DENIED" })
      .mockResolvedValueOnce({ status: "ok", view: reporterView })
      .mockResolvedValueOnce({ status: "denied", code: "ACCESS_DENIED" }),
    revoke: () => Promise.resolve({ status: "ok" }),
    act: () => Promise.resolve({ status: "denied", code: "ACCESS_DENIED" }),
    ...accountlessOverrides,
  };
  return {
    accountless,
    api: { handle } satisfies PublicApi,
    deleteRow,
    getRow,
    tables: { getRow, deleteRow } satisfies AppwriteG1MatrixTables,
  };
}

const successfulResponses: readonly PublicApiResponse[] = [
  {
    statusCode: 201,
    body: {
      status: "accepted",
      replayed: false,
      reference: "Y7-G1-TEST",
      accessProof: proof,
    },
  },
  {
    statusCode: 200,
    body: {
      status: "accepted",
      replayed: true,
      reference: "Y7-G1-TEST",
      accessProof: proof,
    },
  },
  { statusCode: 409, body: { error: "ERR-OPERATION-CONFLICT" } },
  { statusCode: 404, body: { error: "ERR-ACCESS-DENIED" } },
  { statusCode: 200, body: { status: "ok", feedback: { state: "received" } } },
];

function responsesWith(index: number, response: PublicApiResponse) {
  const responses = structuredClone(successfulResponses) as PublicApiResponse[];
  responses[index] = response;
  return responses;
}

async function expectFailure(
  responses: readonly PublicApiResponse[],
  rows: readonly unknown[] = protectedRows,
  accountlessOverrides: Partial<AccountlessAccessCoordinator> = {},
) {
  const setupResult = setup(responses, rows, accountlessOverrides);
  await expect(
    runAppwriteG1Matrix(
      setupResult.api,
      setupResult.tables,
      schema,
      ids,
      operationId,
      setupResult.accountless,
    ),
  ).rejects.toThrow(/^APPWRITE_G1_[A-Z_]+_FAILED$/u);
  expect(setupResult.deleteRow).toHaveBeenCalledTimes(7);
}

describe("real Appwrite G1 matrix", () => {
  it("BDD-G1-REAL-001 proves acceptance, replay, denial, retrieval, envelopes, and cleanup", async () => {
    const { accountless, api, tables, deleteRow, getRow } = setup(successfulResponses);

    await expect(
      runAppwriteG1Matrix(api, tables, schema, ids, operationId, accountless),
    ).resolves.toEqual({
      accepted: true,
      replayed: true,
      conflictDenied: true,
      invalidProofDenied: true,
      authorizedRetrieval: true,
      rotated: true,
      oldProofDenied: true,
      rotatedProofAuthorized: true,
      revoked: true,
      revokedProofDenied: true,
      sensitiveRowsEncrypted: true,
      cleanedRows: 7,
    });
    expect(getRow).toHaveBeenCalledTimes(5);
    expect(deleteRow).toHaveBeenCalledTimes(7);
  });

  it("BDD-G1-REAL-002 fails closed and still cleans every synthetic row", async () => {
    await expectFailure([
      { statusCode: 503, body: { error: "ERR-INTAKE-UNAVAILABLE" } },
    ]);
  });

  it("BDD-G1-REAL-003 tolerates only missing rows during cleanup", async () => {
    const first = setup([]);
    first.deleteRow.mockRejectedValue({ code: 404 });
    await expect(
      runAppwriteG1Matrix(
        first.api,
        first.tables,
        schema,
        ids,
        operationId,
        first.accountless,
      ),
    ).rejects.toThrow("APPWRITE_G1_INTAKE_FAILED");

    const second = setup([]);
    second.deleteRow.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(
      runAppwriteG1Matrix(
        second.api,
        second.tables,
        schema,
        ids,
        operationId,
        second.accountless,
      ),
    ).rejects.toThrow("cleanup failed");
  });

  it("BDD-G1-REAL-007 rejects inconsistent rotation and revocation outcomes", async () => {
    for (const rotate of [
      { status: "denied", code: "ACCESS_DENIED" } as const,
      { status: "ok", reference: "wrong", accessProof: rotatedProof } as const,
      { status: "ok", reference: "Y7-G1-TEST", accessProof: proof } as const,
    ]) {
      await expectFailure(successfulResponses, protectedRows, {
        rotate: () => Promise.resolve(rotate),
      });
    }
    await expectFailure(successfulResponses, protectedRows, {
      retrieve: () => Promise.resolve({ status: "ok", view: reporterView }),
    });
    await expectFailure(successfulResponses, protectedRows, {
      retrieve: vi
        .fn()
        .mockResolvedValueOnce({ status: "denied", code: "ACCESS_DENIED" })
        .mockResolvedValueOnce({ status: "denied", code: "ACCESS_DENIED" }),
    });
    await expectFailure(successfulResponses, protectedRows, {
      revoke: () => Promise.resolve({ status: "denied", code: "ACCESS_DENIED" }),
    });
    await expectFailure(successfulResponses, protectedRows, {
      retrieve: vi
        .fn()
        .mockResolvedValueOnce({ status: "denied", code: "ACCESS_DENIED" })
        .mockResolvedValueOnce({ status: "ok", view: reporterView })
        .mockResolvedValueOnce({ status: "ok", view: reporterView }),
    });
  });

  it("BDD-G1-REAL-004 rejects every inconsistent service outcome", async () => {
    for (const body of [
      null,
      [],
      { status: "wrong", replayed: false, reference: "Y7-G1-TEST", accessProof: proof },
      {
        status: "accepted",
        replayed: true,
        reference: "Y7-G1-TEST",
        accessProof: proof,
      },
      { status: "accepted", replayed: false, reference: 7, accessProof: proof },
      { status: "accepted", replayed: false, reference: "Y7-G1-TEST", accessProof: 7 },
    ]) {
      await expectFailure(responsesWith(0, { statusCode: 201, body }));
    }
    for (const body of [
      { replayed: false, reference: "Y7-G1-TEST", accessProof: proof },
      { replayed: true, reference: "wrong", accessProof: proof },
      { replayed: true, reference: "Y7-G1-TEST", accessProof: "wrong" },
    ]) {
      await expectFailure(responsesWith(1, { statusCode: 200, body }));
    }
    await expectFailure(
      responsesWith(2, { statusCode: 409, body: { error: "wrong" } }),
    );
    await expectFailure(
      responsesWith(3, { statusCode: 404, body: { error: "wrong" } }),
    );
    await expectFailure(
      responsesWith(4, { statusCode: 200, body: { status: "wrong" } }),
    );
    await expectFailure(
      responsesWith(4, {
        statusCode: 200,
        body: { status: "ok", feedback: { internalNotes: [] } },
      }),
    );
  });

  it("BDD-G1-REAL-005 rejects plaintext, misplaced, and malformed envelopes", async () => {
    const unsafeRows: readonly (readonly unknown[])[] = [
      [{ attributionJson: "G1 private intake marker" }, ...protectedRows.slice(1)],
      [{ attributionJson: proof }, ...protectedRows.slice(1)],
      [null, ...protectedRows.slice(1)],
      [{ attributionJson: 7 }, ...protectedRows.slice(1)],
      [{ attributionJson: "plain" }, ...protectedRows.slice(1)],
      [
        protectedRows[0],
        { originalSourceJson: "plain", currentSourceJson: "v1.key.nonce.cipher.tag" },
        ...protectedRows.slice(2),
      ],
      [
        protectedRows[0],
        { originalSourceJson: "v1.key.nonce.cipher.tag", currentSourceJson: "plain" },
        ...protectedRows.slice(2),
      ],
      [...protectedRows.slice(0, 2), { verifier: "plain" }, ...protectedRows.slice(3)],
      [...protectedRows.slice(0, 3), { payloadJson: "plain" }, protectedRows[4]],
      [
        ...protectedRows.slice(0, 4),
        { protectedProof: "plain", proofVerifier: "v1.key.nonce.cipher.tag" },
      ],
      [
        ...protectedRows.slice(0, 4),
        { protectedProof: "v1.key.nonce.cipher.tag", proofVerifier: "plain" },
      ],
    ];
    for (const rows of unsafeRows) await expectFailure(successfulResponses, rows);
  });

  it("BDD-G1-REAL-006 normalizes non-Error matrix and cleanup failures", async () => {
    const first = setup(successfulResponses);
    first.getRow.mockRejectedValue("database failure");
    await expect(
      runAppwriteG1Matrix(
        first.api,
        first.tables,
        schema,
        ids,
        operationId,
        first.accountless,
      ),
    ).rejects.toThrow("APPWRITE_G1_ENVELOPES_FAILED");

    const second = setup(successfulResponses);
    second.deleteRow.mockRejectedValue("cleanup failure");
    await expect(
      runAppwriteG1Matrix(
        second.api,
        second.tables,
        schema,
        ids,
        operationId,
        second.accountless,
      ),
    ).rejects.toThrow("APPWRITE_G1_CLEANUP_FAILED");
  });
});

describe("real Appwrite G1 rollback matrix", () => {
  function missingRow(): Error & { readonly code: 404 } {
    return Object.assign(new Error("missing"), { code: 404 as const });
  }

  function rollbackSetup(response: PublicApiResponse) {
    const api: PublicApi = { handle: () => Promise.resolve(response) };
    const getRow = vi.fn<AppwriteG1MatrixTables["getRow"]>(() =>
      Promise.reject(missingRow()),
    );
    const deleteRow = vi.fn<AppwriteG1MatrixTables["deleteRow"]>(() =>
      Promise.reject(missingRow()),
    );
    return {
      api,
      deleteRow,
      getRow,
      tables: { getRow, deleteRow } satisfies AppwriteG1MatrixTables,
    };
  }

  it("BDD-G1-REAL-008 proves forced failure leaves no partial Appwrite row", async () => {
    const context = rollbackSetup({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });

    await expect(
      runAppwriteG1RollbackMatrix(
        context.api,
        context.tables,
        schema,
        ids,
        operationId,
      ),
    ).resolves.toEqual({
      failureReturnedRetryable: true,
      partialRowsAbsent: true,
      checkedRows: 7,
      cleanedRows: 0,
    });
    expect(context.getRow).toHaveBeenCalledTimes(7);
    expect(context.deleteRow).toHaveBeenCalledTimes(7);
  });

  it("BDD-G1-REAL-009 fails if the response or rollback state is inconsistent", async () => {
    const wrongResponse = rollbackSetup({
      statusCode: 503,
      body: { error: "wrong" },
    });
    await expect(
      runAppwriteG1RollbackMatrix(
        wrongResponse.api,
        wrongResponse.tables,
        schema,
        ids,
        operationId,
      ),
    ).rejects.toThrow("APPWRITE_G1_ROLLBACK_FAILED");

    const visible = rollbackSetup({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });
    visible.getRow.mockResolvedValueOnce({ $id: ids.reporterId });
    visible.deleteRow.mockResolvedValueOnce({});
    await expect(
      runAppwriteG1RollbackMatrix(
        visible.api,
        visible.tables,
        schema,
        ids,
        operationId,
      ),
    ).rejects.toThrow("APPWRITE_G1_ROLLBACK_FAILED");

    const unavailable = rollbackSetup({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });
    unavailable.getRow.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(
      runAppwriteG1RollbackMatrix(
        unavailable.api,
        unavailable.tables,
        schema,
        ids,
        operationId,
      ),
    ).rejects.toThrow("APPWRITE_G1_ROLLBACK_FAILED");
  });

  it("BDD-G1-REAL-010 preserves a rollback cleanup failure", async () => {
    const context = rollbackSetup({
      statusCode: 503,
      body: { error: "ERR-INTAKE-UNAVAILABLE" },
    });
    context.deleteRow.mockRejectedValueOnce("cleanup unavailable");
    await expect(
      runAppwriteG1RollbackMatrix(
        context.api,
        context.tables,
        schema,
        ids,
        operationId,
      ),
    ).rejects.toThrow("APPWRITE_G1_ROLLBACK_CLEANUP_FAILED");
  });
});
