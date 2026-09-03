import { Query, type Users } from "node-appwrite";

import type { PlatformAuthority } from "./platform-access.js";

export interface AppwritePlatformAuthorityUsersPort {
  listMemberships(input: {
    readonly userId: string;
    readonly queries: readonly string[];
    readonly total: false;
  }): Promise<unknown>;
  listSessions(input: {
    readonly userId: string;
    readonly total: false;
  }): Promise<unknown>;
}

export interface AppwritePlatformAuthorityConfig {
  readonly operatorTeamId: string;
  readonly ownerTeamId: string;
  readonly maximumMfaAgeMs: number;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payload(jwt: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const encoded = jwt.split(".")[1];
    if (!encoded) return undefined;
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    return object(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rows(value: unknown, key: "memberships" | "sessions"): readonly unknown[] {
  return object(value) && Array.isArray(value[key]) ? value[key] : [];
}

export function createAppwritePlatformAuthority(
  users: AppwritePlatformAuthorityUsersPort,
  config: AppwritePlatformAuthorityConfig,
  now: () => number,
): PlatformAuthority {
  if (
    !identifier.test(config.operatorTeamId) ||
    !identifier.test(config.ownerTeamId) ||
    config.operatorTeamId === config.ownerTeamId ||
    !Number.isSafeInteger(config.maximumMfaAgeMs) ||
    config.maximumMfaAgeMs < 60_000 ||
    config.maximumMfaAgeMs > 15 * 60_000
  )
    throw new Error("APPWRITE_PLATFORM_AUTHORITY_CONFIG_INVALID");
  return {
    async authorize(input) {
      const claims = payload(input.jwt);
      const sessionId = claims?.sessionId;
      if (
        claims?.userId !== input.principalId ||
        typeof sessionId !== "string" ||
        !identifier.test(sessionId)
      )
        return { status: "denied" };
      try {
        const teamId =
          input.role === "platform_operator"
            ? config.operatorTeamId
            : config.ownerTeamId;
        const [memberships, sessions] = await Promise.all([
          users.listMemberships({
            userId: input.principalId,
            queries: [Query.equal("teamId", [teamId]), Query.limit(2)],
            total: false,
          }),
          users.listSessions({ userId: input.principalId, total: false }),
        ]);
        const membership = rows(memberships, "memberships").find(
          (value) =>
            object(value) &&
            value.userId === input.principalId &&
            value.teamId === teamId &&
            value.confirm === true &&
            Array.isArray(value.roles) &&
            value.roles.includes(input.role),
        );
        if (!membership) return { status: "denied" };
        const session = rows(sessions, "sessions").find(
          (value) =>
            object(value) &&
            value.$id === sessionId &&
            value.userId === input.principalId,
        );
        if (!object(session)) return { status: "denied" };
        const mfaUpdatedAt = Date.parse(String(session.mfaUpdatedAt));
        const expiresAt = Date.parse(String(session.expire));
        const current = now();
        const freshMfa =
          Array.isArray(session.factors) &&
          session.factors.length >= 2 &&
          Number.isFinite(mfaUpdatedAt) &&
          mfaUpdatedAt <= current &&
          current - mfaUpdatedAt <= config.maximumMfaAgeMs &&
          Number.isFinite(expiresAt) &&
          expiresAt > current;
        return { status: "authorized", freshMfa };
      } catch {
        return { status: "retryable" };
      }
    },
  };
}

export function createNodeAppwritePlatformAuthority(
  users: Users,
  config: AppwritePlatformAuthorityConfig,
  now: () => number,
): PlatformAuthority {
  return createAppwritePlatformAuthority(
    {
      listMemberships: (input) =>
        users.listMemberships({ ...input, queries: [...input.queries] }),
      listSessions: (input) => users.listSessions(input),
    },
    config,
    now,
  );
}
