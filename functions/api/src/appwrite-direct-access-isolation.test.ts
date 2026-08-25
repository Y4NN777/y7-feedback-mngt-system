import { describe, expect, it, vi } from "vitest";

import {
  runDirectAccessIsolationMatrix,
  type DirectAccessIsolationPort,
} from "./appwrite-direct-access-isolation";

const principals = ["owner-jwt", "maintainer-jwt"] as const;
const surfaces = [
  "projects",
  "feedback",
  "notifications",
  "source_connections",
  "provider_grants",
  "files",
] as const;

function setup(
  overrides: Partial<DirectAccessIsolationPort> = {},
): DirectAccessIsolationPort {
  return {
    countVisible: vi.fn(() => Promise.resolve(0)),
    readSentinel: vi.fn(() => Promise.resolve("denied" as const)),
    createSyntheticSource: vi.fn(() => Promise.resolve("denied" as const)),
    updateSyntheticGrant: vi.fn(() => Promise.resolve("denied" as const)),
    deleteSyntheticGrant: vi.fn(() => Promise.resolve("denied" as const)),
    observeRealtime: vi.fn(() => Promise.resolve("isolated" as const)),
    ...overrides,
  };
}

describe("Appwrite direct-access isolation matrix", () => {
  it("BDD-OWN-REAL-001 denies every private surface to both real principals", async () => {
    const countVisible = vi.fn(() => Promise.resolve(0));
    const readSentinel = vi.fn(() => Promise.resolve("denied" as const));
    const createSyntheticSource = vi.fn(() => Promise.resolve("denied" as const));
    const updateSyntheticGrant = vi.fn(() => Promise.resolve("denied" as const));
    const deleteSyntheticGrant = vi.fn(() => Promise.resolve("denied" as const));
    const observeRealtime = vi.fn(() => Promise.resolve("isolated" as const));
    const port = setup({
      countVisible,
      readSentinel,
      createSyntheticSource,
      updateSyntheticGrant,
      deleteSyntheticGrant,
      observeRealtime,
    });

    await expect(
      runDirectAccessIsolationMatrix(port, principals, surfaces),
    ).resolves.toEqual({
      principalsChecked: 2,
      surfacesChecked: 6,
      listIsolation: true,
      sentinelIsolation: true,
      mutationIsolation: true,
      realtimeIsolation: true,
    });
    expect(countVisible).toHaveBeenCalledTimes(12);
    expect(readSentinel).toHaveBeenCalledTimes(12);
    expect(createSyntheticSource).toHaveBeenCalledTimes(2);
    expect(updateSyntheticGrant).toHaveBeenCalledTimes(2);
    expect(deleteSyntheticGrant).toHaveBeenCalledTimes(2);
    expect(observeRealtime).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["visible row", setup({ countVisible: () => Promise.resolve(1) })],
    [
      "readable sentinel",
      setup({ readSentinel: () => Promise.resolve("allowed" as const) }),
    ],
    [
      "direct mutation",
      setup({ createSyntheticSource: () => Promise.resolve("allowed" as const) }),
    ],
    [
      "direct update",
      setup({ updateSyntheticGrant: () => Promise.resolve("allowed" as const) }),
    ],
    [
      "direct delete",
      setup({ deleteSyntheticGrant: () => Promise.resolve("allowed" as const) }),
    ],
    [
      "realtime disclosure",
      setup({ observeRealtime: () => Promise.resolve("leaked" as const) }),
    ],
    [
      "dependency failure",
      setup({ countVisible: () => Promise.reject(new Error("network")) }),
    ],
  ])("BDD-OWN-REAL-002 fails closed on %s", async (_name, port) => {
    await expect(
      runDirectAccessIsolationMatrix(port, principals, surfaces),
    ).rejects.toThrow("APPWRITE_DIRECT_ACCESS_ISOLATION_FAILED");
  });

  it("rejects an incomplete matrix before accessing Appwrite", async () => {
    const countVisible = vi.fn(() => Promise.resolve(0));
    const port = setup({ countVisible });

    await expect(runDirectAccessIsolationMatrix(port, [], surfaces)).rejects.toThrow(
      "APPWRITE_DIRECT_ACCESS_MATRIX_INVALID",
    );
    await expect(runDirectAccessIsolationMatrix(port, principals, [])).rejects.toThrow(
      "APPWRITE_DIRECT_ACCESS_MATRIX_INVALID",
    );
    expect(countVisible).not.toHaveBeenCalled();
  });
});
