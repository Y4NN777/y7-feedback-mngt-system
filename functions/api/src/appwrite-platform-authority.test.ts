import { describe, expect, it, vi } from "vitest";

const nodeSdk = vi.hoisted(() => ({
  memberships: vi.fn(() => Promise.resolve({ memberships: [] })),
  sessions: vi.fn(() => Promise.resolve({ sessions: [] })),
}));

vi.mock("node-appwrite", async (original) => {
  const sdk = await original<typeof import("node-appwrite")>();
  return {
    ...sdk,
    Query: {
      equal: (key: string, values: string[]) => `equal:${key}:${values[0]}`,
      limit: (limit: number) => `limit:${limit}`,
    },
  };
});

import {
  createAppwritePlatformAuthority,
  createNodeAppwritePlatformAuthority,
} from "./appwrite-platform-authority";

const now = Date.parse("2026-09-03T12:00:00.000Z");
const config = {
  operatorTeamId: "platform_operators",
  ownerTeamId: "platform_owners",
  maximumMfaAgeMs: 5 * 60_000,
};
const sessionFixture = {
  $id: "session_1",
  userId: "operator_1",
  factors: ["password", "totp"],
  mfaUpdatedAt: "2026-09-03T11:58:00.000Z",
  expire: "2026-09-03T13:00:00.000Z",
};

function jwt(payload: unknown): string {
  return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function setup() {
  const listMemberships = vi.fn(() =>
    Promise.resolve({
      memberships: [
        {
          userId: "operator_1",
          teamId: "platform_operators",
          confirm: true,
          roles: ["platform_operator"],
        },
      ],
    }),
  );
  const listSessions = vi.fn(() =>
    Promise.resolve({
      sessions: [sessionFixture],
    }),
  );
  return {
    listMemberships,
    listSessions,
    authority: createAppwritePlatformAuthority(
      { listMemberships, listSessions },
      config,
      () => now,
    ),
  };
}

describe("Appwrite Platform role and MFA authority", () => {
  it("BDD-PLAT-120 binds the verified principal, team role and exact JWT session", async () => {
    const target = setup();
    await expect(
      target.authority.authorize({
        principalId: "operator_1",
        jwt: jwt({ userId: "operator_1", sessionId: "session_1", exp: 1 }),
        role: "platform_operator",
      }),
    ).resolves.toEqual({ status: "authorized", freshMfa: true });
    expect(target.listMemberships).toHaveBeenCalledWith({
      userId: "operator_1",
      queries: ["equal:teamId:platform_operators", "limit:2"],
      total: false,
    });
  });

  it("BDD-PLAT-121 denies forged, mismatched and malformed JWT session claims", async () => {
    for (const token of [
      "bad",
      "a.ew.c",
      "a.e30.c",
      jwt([]),
      jwt({ userId: "other", sessionId: "session_1" }),
      jwt({ userId: "operator_1", sessionId: "bad id" }),
    ]) {
      const target = setup();
      await expect(
        target.authority.authorize({
          principalId: "operator_1",
          jwt: token,
          role: "platform_operator",
        }),
      ).resolves.toEqual({ status: "denied" });
      expect(target.listMemberships).not.toHaveBeenCalled();
    }
  });

  it("BDD-PLAT-122 denies absent, unconfirmed, wrong-team or wrong-role membership", async () => {
    for (const membership of [
      undefined,
      {
        userId: "other",
        teamId: "platform_operators",
        confirm: true,
        roles: ["platform_operator"],
      },
      {
        userId: "operator_1",
        teamId: "other",
        confirm: true,
        roles: ["platform_operator"],
      },
      {
        userId: "operator_1",
        teamId: "platform_operators",
        confirm: false,
        roles: ["platform_operator"],
      },
      {
        userId: "operator_1",
        teamId: "platform_operators",
        confirm: true,
        roles: ["platform_owner"],
      },
    ]) {
      const target = setup();
      target.listMemberships.mockResolvedValueOnce({
        memberships: membership ? [membership] : [],
      });
      await expect(
        target.authority.authorize({
          principalId: "operator_1",
          jwt: jwt({ userId: "operator_1", sessionId: "session_1" }),
          role: "platform_operator",
        }),
      ).resolves.toEqual({ status: "denied" });
    }
  });

  it("BDD-PLAT-123 derives MFA freshness from the exact live server session", async () => {
    for (const override of [
      { $id: "other" },
      { userId: "other" },
      { factors: ["password"] },
      { mfaUpdatedAt: "invalid" },
      { mfaUpdatedAt: "2026-09-03T12:01:00.000Z" },
      { mfaUpdatedAt: "2026-09-03T11:54:59.999Z" },
      { expire: "invalid" },
      { expire: "2026-09-03T12:00:00.000Z" },
    ]) {
      const target = setup();
      target.listSessions.mockResolvedValueOnce({
        sessions: [{ ...sessionFixture, ...override }],
      });
      const result = await target.authority.authorize({
        principalId: "operator_1",
        jwt: jwt({ userId: "operator_1", sessionId: "session_1" }),
        role: "platform_operator",
      });
      expect(result).toMatchObject(
        override.$id || override.userId
          ? { status: "denied" }
          : { status: "authorized", freshMfa: false },
      );
    }
  });

  it("BDD-PLAT-124 selects the distinct owner team and fails closed on malformed or unavailable results", async () => {
    const owner = setup();
    owner.listMemberships.mockResolvedValueOnce({
      memberships: [
        {
          userId: "operator_1",
          teamId: "platform_owners",
          confirm: true,
          roles: ["platform_owner"],
        },
      ],
    });
    await owner.authority.authorize({
      principalId: "operator_1",
      jwt: jwt({ userId: "operator_1", sessionId: "session_1" }),
      role: "platform_owner",
    });
    expect(owner.listMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ queries: ["equal:teamId:platform_owners", "limit:2"] }),
    );

    for (const failure of [
      { memberships: {} },
      new Error("private authority failure"),
    ]) {
      const target = setup();
      if (failure instanceof Error)
        target.listMemberships.mockRejectedValueOnce(failure);
      else target.listMemberships.mockResolvedValueOnce(failure as never);
      await expect(
        target.authority.authorize({
          principalId: "operator_1",
          jwt: jwt({ userId: "operator_1", sessionId: "session_1" }),
          role: "platform_operator",
        }),
      ).resolves.toMatchObject(
        failure instanceof Error ? { status: "retryable" } : { status: "denied" },
      );
    }
  });

  it("adapts Node Appwrite Users and validates authority configuration", async () => {
    const authority = createNodeAppwritePlatformAuthority(
      {
        listMemberships: nodeSdk.memberships,
        listSessions: nodeSdk.sessions,
      } as never,
      config,
      () => now,
    );
    await authority.authorize({
      principalId: "operator_1",
      jwt: jwt({ userId: "operator_1", sessionId: "session_1" }),
      role: "platform_operator",
    });
    expect(nodeSdk.memberships).toHaveBeenCalled();
    for (const invalid of [
      { ...config, operatorTeamId: "bad id" },
      { ...config, ownerTeamId: "bad id" },
      { ...config, ownerTeamId: config.operatorTeamId },
      { ...config, maximumMfaAgeMs: 59_999 },
      { ...config, maximumMfaAgeMs: 15 * 60_000 + 1 },
      { ...config, maximumMfaAgeMs: 60_000.5 },
    ])
      expect(() =>
        createAppwritePlatformAuthority(setup(), invalid, () => now),
      ).toThrow("APPWRITE_PLATFORM_AUTHORITY_CONFIG_INVALID");
  });
});
