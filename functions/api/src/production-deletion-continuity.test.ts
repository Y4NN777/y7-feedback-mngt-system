import { describe, expect, it, vi } from "vitest";

import { proveProductionDeletionContinuity } from "./production-deletion-continuity";

function missing(): Error & { code: number } {
  return Object.assign(new Error("missing"), { code: 404 });
}

describe("Production deletion continuity probe", () => {
  it("BDD-REL-411 keeps a deleted marker absent across rollback and roll-forward", async () => {
    let present = false;
    const observe = vi.fn(() => {
      expect(present).toBe(false);
      return Promise.resolve();
    });
    const result = await proveProductionDeletionContinuity(
      {
        createTable: vi.fn().mockResolvedValue(undefined),
        deleteTable: vi.fn().mockResolvedValue(undefined),
        createRow: vi.fn(() => {
          present = true;
          return Promise.resolve();
        }),
        deleteRow: vi.fn(() => {
          present = false;
          return Promise.resolve();
        }),
        getRow: vi.fn(() => {
          if (!present) return Promise.reject(missing());
          return Promise.resolve({ $id: "marker" });
        }),
      },
      {
        databaseId: "feedback",
        tableId: "rel_probe_0123456789abcdef",
        markerId: "marker_0123456789abcdef",
        rollback: observe,
        rollForward: observe,
      },
    );

    expect(result).toEqual({ rollbackAbsent: true, rollForwardAbsent: true });
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("BDD-REL-412 fails when a deployment makes the deleted marker visible", async () => {
    let reads = 0;
    const target = proveProductionDeletionContinuity(
      {
        createTable: vi.fn().mockResolvedValue(undefined),
        deleteTable: vi.fn().mockResolvedValue(undefined),
        createRow: vi.fn().mockResolvedValue(undefined),
        deleteRow: vi.fn().mockResolvedValue(undefined),
        getRow: vi.fn(() => {
          reads += 1;
          if (reads === 1) return Promise.reject(missing());
          return Promise.resolve({ $id: "marker_0123456789abcdef" });
        }),
      },
      {
        databaseId: "feedback",
        tableId: "rel_probe_0123456789abcdef",
        markerId: "marker_0123456789abcdef",
        rollback: vi.fn().mockResolvedValue(undefined),
        rollForward: vi.fn().mockResolvedValue(undefined),
      },
    );

    await expect(target).rejects.toThrow("PRODUCTION_DELETION_RESURRECTED");
  });

  it("BDD-REL-413 removes the temporary table when verification fails", async () => {
    const deleteTable = vi.fn().mockResolvedValue(undefined);
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockResolvedValue(undefined),
          deleteTable,
          createRow: vi.fn().mockRejectedValue(new Error("write failed")),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("write failed");
    expect(deleteTable).toHaveBeenCalledOnce();
  });

  it("BDD-REL-414 always restores the candidate after a rollback probe failure", async () => {
    const rollForward = vi.fn().mockResolvedValue(undefined);
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockResolvedValue(undefined),
          deleteTable: vi.fn().mockResolvedValue(undefined),
          createRow: vi.fn().mockResolvedValue(undefined),
          deleteRow: vi.fn().mockResolvedValue(undefined),
          getRow: vi.fn().mockRejectedValue(missing()),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn().mockRejectedValue(new Error("rollback failed")),
          rollForward,
        },
      ),
    ).rejects.toThrow("rollback failed");
    expect(rollForward).toHaveBeenCalledOnce();
  });

  it("fails closed when absence cannot be established", async () => {
    const unavailable = new Error("read unavailable");
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockResolvedValue(undefined),
          deleteTable: vi.fn().mockResolvedValue(undefined),
          createRow: vi.fn().mockResolvedValue(undefined),
          deleteRow: vi.fn().mockResolvedValue(undefined),
          getRow: vi.fn().mockRejectedValue(unavailable),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toBe(unavailable);
  });

  it("surfaces cleanup failure after a successful continuity proof", async () => {
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockResolvedValue(undefined),
          deleteTable: vi.fn().mockRejectedValue(new Error("cleanup failed")),
          createRow: vi.fn().mockResolvedValue(undefined),
          deleteRow: vi.fn().mockResolvedValue(undefined),
          getRow: vi.fn().mockRejectedValue(missing()),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn().mockResolvedValue(undefined),
          rollForward: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow("cleanup failed");
  });

  it("preserves the originating failure when cleanup also fails", async () => {
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockResolvedValue(undefined),
          deleteTable: vi.fn().mockRejectedValue(new Error("cleanup failed")),
          createRow: vi.fn().mockRejectedValue(new Error("write failed")),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("write failed");
  });

  it("does not delete a table that was never created", async () => {
    const deleteTable = vi.fn();
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockRejectedValue(new Error("create failed")),
          deleteTable,
          createRow: vi.fn(),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("create failed");
    expect(deleteTable).not.toHaveBeenCalled();
  });

  it("normalizes non-error adapter failures", async () => {
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn().mockRejectedValue("untyped failure"),
          deleteTable: vi.fn(),
          createRow: vi.fn(),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "feedback",
          tableId: "rel_probe_0123456789abcdef",
          markerId: "marker_0123456789abcdef",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("PRODUCTION_DELETION_PROBE_FAILED");
  });

  it("rejects invalid identifiers before creating a resource", async () => {
    const createTable = vi.fn();
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable,
          deleteTable: vi.fn(),
          createRow: vi.fn(),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "bad/id",
          tableId: "probe",
          markerId: "marker",
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("PRODUCTION_DELETION_PROBE_INVALID");
    expect(createTable).not.toHaveBeenCalled();
  });

  it.each([
    { tableId: "bad/id", markerId: "marker" },
    { tableId: "probe", markerId: "bad/id" },
  ])("rejects invalid probe identifiers %#", async ({ tableId, markerId }) => {
    await expect(
      proveProductionDeletionContinuity(
        {
          createTable: vi.fn(),
          deleteTable: vi.fn(),
          createRow: vi.fn(),
          deleteRow: vi.fn(),
          getRow: vi.fn(),
        },
        {
          databaseId: "feedback",
          tableId,
          markerId,
          rollback: vi.fn(),
          rollForward: vi.fn(),
        },
      ),
    ).rejects.toThrow("PRODUCTION_DELETION_PROBE_INVALID");
  });
});
