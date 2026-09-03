import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  Account,
  AuthenticationFactor,
  AuthenticatorType,
  Client,
  ExecutionMethod,
  Functions,
  Query,
  TablesDB,
  Teams,
  Users,
} from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { previewFunctionId } from "./appwrite-function-variables.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(value: unknown): boolean {
  return object(value) && value.code === 404;
}

function base32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/u, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("APPWRITE_G4_PLATFORM_MFA_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = Number(digest.at(-1)) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function expectResult(
  value: unknown,
  expected: { readonly state: string; readonly revision: number },
) {
  if (
    !object(value) ||
    value.status !== "ok" ||
    !object(value.result) ||
    value.result.state !== expected.state ||
    value.result.revision !== expected.revision
  )
    throw new Error("APPWRITE_G4_PLATFORM_RESULT_INVALID");
  return value.result;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("APPWRITE_G4_PLATFORM_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview")
    throw new Error("APPWRITE_G4_PLATFORM_PREVIEW_REQUIRED");
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G4_PLATFORM_DOMAIN_REQUIRED");

  const suffix = randomBytes(6).toString("hex");
  const workspaceId = `g4pw_${suffix}`;
  const projectId = `g4pp_${suffix}`;
  const feedbackId = `g4pf_${suffix}`;
  const operatorId = `g4po_${suffix}`;
  const ownerId = `g4pn_${suffix}`;
  const outsiderId = `g4px_${suffix}`;
  const ordinaryGrantId = `g4pg_${suffix}`;
  const expiryGrantId = `g4pe_${suffix}`;
  const breakGlassGrantId = `g4pb_${suffix}`;
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const users = new Users(client);
  const teams = new Teams(client);
  const functions = new Functions(client);
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const createdUsers: string[] = [];
  const createdMemberships: Array<readonly [string, string]> = [];
  const grantIds = [ordinaryGrantId, expiryGrantId, breakGlassGrantId];
  let feedbackCreated = false;
  let cleanupFailure: unknown;

  const findTeam = async (name: string) => {
    const result = await teams.list({
      queries: [Query.equal("name", [name]), Query.limit(2)],
      total: false,
    });
    const team = result.teams.find((candidate) => candidate.name === name);
    if (!team) throw new Error("APPWRITE_G4_PLATFORM_TEAM_MISSING");
    return team.$id;
  };
  const createPrincipal = async (userId: string) => {
    const email = `${userId}@example.invalid`;
    const password = `Y7-${randomBytes(18).toString("base64url")}`;
    await users.create({ userId, email, password, name: "G4 Platform verifier" });
    createdUsers.push(userId);
    const session = await users.createSession({ userId });
    const account = new Account(
      new Client()
        .setEndpoint(config.appwriteEndpoint)
        .setProject(config.appwriteProjectId)
        .setSession(session.secret),
    );
    const authenticator = await account.createMFAAuthenticator({
      type: AuthenticatorType.Totp,
    });
    await account.updateMFAAuthenticator({
      type: AuthenticatorType.Totp,
      otp: totp(authenticator.secret),
    });
    await account.updateMFA({ mfa: true });
    const challenge = await account.createMFAChallenge({
      factor: AuthenticationFactor.Totp,
    });
    await account.updateMFAChallenge({
      challengeId: challenge.$id,
      otp: totp(authenticator.secret),
    });
    return (await users.createJWT({ userId, sessionId: session.$id, duration: 900 }))
      .jwt;
  };
  const addMembership = async (teamId: string, userId: string, role: string) => {
    const membership = await teams.createMembership({
      teamId,
      roles: [role],
      userId,
    });
    createdMemberships.push([teamId, membership.$id]);
  };
  const request = async (jwt: string, command: unknown, expectedStatus: number) => {
    const response = await fetch(
      new URL("/v1/platform/exceptional-access/commands", domain),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body: unknown = await response.json();
    if (response.status !== expectedStatus)
      throw new Error(
        `APPWRITE_G4_PLATFORM_HTTP_${String(expectedStatus)}_GOT_${String(response.status)}`,
      );
    return body;
  };
  const rowsForGrant = async (tableId: string, grantId: string) =>
    (
      await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        queries: [Query.equal("grantId", [grantId]), Query.limit(100)],
        total: false,
      })
    ).rows;

  let selfApprovalDenied = false;
  let maximumDurationDenied = false;
  let scopeBreachDenied = false;
  let beforeApprovalDenied = false;
  let afterExpiryDenied = false;
  let immutableAuditPassed = false;
  let concurrentRevokeUsePassed = false;
  let exactContentPassed = false;
  let idempotentReplayPassed = false;
  let breakGlassReviewPassed = false;
  let standingAccessDenied = false;
  let missingPrincipalDenied = false;
  try {
    const [operatorTeamId, ownerTeamId] = await Promise.all([
      findTeam("platform_operators"),
      findTeam("platform_owners"),
    ]);
    const [operatorJwt, ownerJwt, outsiderJwt] = await Promise.all([
      createPrincipal(operatorId),
      createPrincipal(ownerId),
      createPrincipal(outsiderId),
    ]);
    await addMembership(operatorTeamId, operatorId, "platform_operator");
    await addMembership(ownerTeamId, ownerId, "platform_owner");
    await addMembership(ownerTeamId, operatorId, "platform_owner");

    const tableId = config.appwriteSchema.feedbackTableId;
    const seal = (field: string, value: unknown) =>
      protector.seal(
        { environment: config.environment, tableId, rowId: feedbackId, field },
        JSON.stringify(value),
      );
    const acceptedAt = new Date().toISOString();
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId: feedbackId,
      permissions: [],
      data: {
        workspaceId,
        projectId,
        reporterId: `g4pr_${suffix}`,
        type: "bug",
        state: "received",
        acceptedAt,
        currentSourceJson: seal("currentSourceJson", {
          type: "bug",
          problem: "Exceptional access exact-content fixture",
        }),
        originalSourceJson: seal("originalSourceJson", {
          type: "bug",
          problem: "Exceptional access exact-content fixture",
        }),
        contextJson: seal("contextJson", []),
        attachmentNamesJson: seal("attachmentNamesJson", []),
      },
    });
    feedbackCreated = true;

    try {
      await new TablesDB(
        new Client()
          .setEndpoint(config.appwriteEndpoint)
          .setProject(config.appwriteProjectId)
          .setJWT(operatorJwt),
      ).getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        rowId: feedbackId,
      });
    } catch {
      standingAccessDenied = true;
    }

    const ordinaryRequest = {
      kind: "request",
      grantId: ordinaryGrantId,
      workspaceId,
      projectId,
      feedbackId,
      actions: ["feedback.read"],
      reasonCode: "SUPPORT_INCIDENT",
      justification: "Investigate the declared customer support incident.",
      incidentSeverity: "ordinary",
      breakGlass: false,
    } as const;
    missingPrincipalDenied = object(await request(outsiderJwt, ordinaryRequest, 403));
    expectResult(await request(operatorJwt, ordinaryRequest, 200), {
      state: "requested",
      revision: 0,
    });
    beforeApprovalDenied = object(
      await request(
        operatorJwt,
        {
          kind: "use",
          operationId: randomUUID(),
          grantId: ordinaryGrantId,
          expectedRevision: 0,
          workspaceId,
          projectId,
          feedbackId,
          action: "feedback.read",
        },
        403,
      ),
    );
    selfApprovalDenied = object(
      await request(
        operatorJwt,
        {
          kind: "approve",
          grantId: ordinaryGrantId,
          expectedRevision: 0,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
        403,
      ),
    );
    maximumDurationDenied = object(
      await request(
        ownerJwt,
        {
          kind: "approve",
          grantId: ordinaryGrantId,
          expectedRevision: 0,
          expiresAt: new Date(Date.now() + 60 * 60_000 + 30_000).toISOString(),
        },
        400,
      ),
    );
    expectResult(
      await request(
        ownerJwt,
        {
          kind: "approve",
          grantId: ordinaryGrantId,
          expectedRevision: 0,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
        200,
      ),
      { state: "active", revision: 1 },
    );
    scopeBreachDenied = object(
      await request(
        operatorJwt,
        {
          kind: "use",
          operationId: randomUUID(),
          grantId: ordinaryGrantId,
          expectedRevision: 1,
          workspaceId,
          projectId: `g4pq_${suffix}`,
          feedbackId,
          action: "feedback.read",
        },
        403,
      ),
    );
    const operationId = randomUUID();
    const used = expectResult(
      await request(
        operatorJwt,
        {
          kind: "use",
          operationId,
          grantId: ordinaryGrantId,
          expectedRevision: 1,
          workspaceId,
          projectId,
          feedbackId,
          action: "feedback.read",
        },
        200,
      ),
      { state: "active", revision: 2 },
    );
    exactContentPassed =
      object(used.content) &&
      used.content.kind === "feedback" &&
      object(used.content.feedback) &&
      object(used.content.feedback.source) &&
      used.content.feedback.source.problem ===
        "Exceptional access exact-content fixture";
    const replayed = expectResult(
      await request(
        operatorJwt,
        {
          kind: "use",
          operationId,
          grantId: ordinaryGrantId,
          expectedRevision: 1,
          workspaceId,
          projectId,
          feedbackId,
          action: "feedback.read",
        },
        200,
      ),
      { state: "active", revision: 2 },
    );
    idempotentReplayPassed = replayed.disposition === "replayed";
    await request(
      operatorJwt,
      {
        kind: "use",
        operationId,
        grantId: ordinaryGrantId,
        expectedRevision: 2,
        workspaceId,
        projectId,
        feedbackId,
        action: "feedback.read",
      },
      409,
    );
    const concurrentOperationId = randomUUID();
    const concurrency = await Promise.all([
      request(
        ownerJwt,
        { kind: "revoke", grantId: ordinaryGrantId, expectedRevision: 2 },
        200,
      ).then(
        () => "revoked" as const,
        () => "lost" as const,
      ),
      request(
        operatorJwt,
        {
          kind: "use",
          operationId: concurrentOperationId,
          grantId: ordinaryGrantId,
          expectedRevision: 2,
          workspaceId,
          projectId,
          feedbackId,
          action: "feedback.read",
        },
        200,
      ).then(
        () => "used" as const,
        () => "lost" as const,
      ),
    ]);
    concurrentRevokeUsePassed =
      concurrency.filter((outcome) => outcome !== "lost").length === 1;

    const expiryRequest = { ...ordinaryRequest, grantId: expiryGrantId };
    expectResult(await request(operatorJwt, expiryRequest, 200), {
      state: "requested",
      revision: 0,
    });
    expectResult(
      await request(
        ownerJwt,
        {
          kind: "approve",
          grantId: expiryGrantId,
          expectedRevision: 0,
          expiresAt: new Date(Date.now() + 3_000).toISOString(),
        },
        200,
      ),
      { state: "active", revision: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await functions.createExecution({
      functionId: previewFunctionId,
      body: "{}",
      async: false,
      xpath: "/",
      method: ExecutionMethod.POST,
      headers: { "x-appwrite-trigger": "schedule" },
    });
    const expired = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.exceptionalAccessGrantsTableId,
      rowId: expiryGrantId,
    });
    afterExpiryDenied =
      expired.state === "expired" &&
      object(
        await request(
          operatorJwt,
          {
            kind: "use",
            operationId: randomUUID(),
            grantId: expiryGrantId,
            expectedRevision: 2,
            workspaceId,
            projectId,
            feedbackId,
            action: "feedback.read",
          },
          403,
        ),
      );

    await request(
      operatorJwt,
      { ...ordinaryRequest, grantId: `g4pi_${suffix}`, breakGlass: true },
      400,
    );
    const breakGlassRequest = {
      ...ordinaryRequest,
      grantId: breakGlassGrantId,
      incidentSeverity: "critical",
      breakGlass: true,
    } as const;
    expectResult(await request(operatorJwt, breakGlassRequest, 200), {
      state: "requested",
      revision: 0,
    });
    expectResult(
      await request(
        ownerJwt,
        {
          kind: "approve",
          grantId: breakGlassGrantId,
          expectedRevision: 0,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
        200,
      ),
      { state: "active", revision: 1 },
    );
    expectResult(
      await request(
        operatorJwt,
        {
          kind: "use",
          operationId: randomUUID(),
          grantId: breakGlassGrantId,
          expectedRevision: 1,
          workspaceId,
          projectId,
          feedbackId,
          action: "feedback.read",
        },
        200,
      ),
      { state: "active", revision: 2 },
    );
    expectResult(
      await request(
        ownerJwt,
        { kind: "revoke", grantId: breakGlassGrantId, expectedRevision: 2 },
        200,
      ),
      { state: "review_required", revision: 3 },
    );
    const reviewed = expectResult(
      await request(
        ownerJwt,
        { kind: "review", grantId: breakGlassGrantId, expectedRevision: 3 },
        200,
      ),
      { state: "reviewed", revision: 4 },
    );
    breakGlassReviewPassed = reviewed.disposition === "applied";

    const auditRows = await rowsForGrant(
      config.appwriteSchema.exceptionalAccessAuditTableId,
      ordinaryGrantId,
    );
    if (auditRows.length < 5) throw new Error("APPWRITE_G4_PLATFORM_AUDIT_INCOMPLETE");
    const jwtTables = new TablesDB(
      new Client()
        .setEndpoint(config.appwriteEndpoint)
        .setProject(config.appwriteProjectId)
        .setJWT(operatorJwt),
    );
    try {
      await jwtTables.deleteRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.exceptionalAccessAuditTableId,
        rowId: String(auditRows[0]?.$id),
      });
    } catch {
      const retained = await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.exceptionalAccessAuditTableId,
        rowId: String(auditRows[0]?.$id),
      });
      immutableAuditPassed = retained.$id === auditRows[0]?.$id;
    }

    if (
      !standingAccessDenied ||
      !missingPrincipalDenied ||
      !beforeApprovalDenied ||
      !selfApprovalDenied ||
      !maximumDurationDenied ||
      !scopeBreachDenied ||
      !exactContentPassed ||
      !idempotentReplayPassed ||
      !concurrentRevokeUsePassed ||
      !afterExpiryDenied ||
      !breakGlassReviewPassed ||
      !immutableAuditPassed
    )
      throw new Error("APPWRITE_G4_PLATFORM_ASSERTION_FAILED");
  } finally {
    for (const grantId of grantIds) {
      for (const tableId of [
        config.appwriteSchema.exceptionalAccessOperationsTableId,
        config.appwriteSchema.exceptionalAccessAuditTableId,
      ]) {
        try {
          for (const row of await rowsForGrant(tableId, grantId))
            await tables.deleteRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId,
              rowId: row.$id,
            });
        } catch (error: unknown) {
          cleanupFailure ??= error;
        }
      }
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId: config.appwriteSchema.exceptionalAccessGrantsTableId,
          rowId: grantId,
        });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
    if (feedbackCreated)
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId: config.appwriteSchema.feedbackTableId,
          rowId: feedbackId,
        });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    for (const [teamId, membershipId] of createdMemberships.reverse())
      try {
        await teams.deleteMembership({ teamId, membershipId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    for (const userId of createdUsers.reverse())
      try {
        await users.delete({ userId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
  }
  if (cleanupFailure) throw new Error("APPWRITE_G4_PLATFORM_CLEANUP_FAILED");
  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_G4_PLATFORM_ACCESS_PASSED",
      standingAccessDenied,
      missingPrincipalDenied,
      beforeApprovalDenied,
      selfApprovalDenied,
      maximumDurationDenied,
      scopeBreachDenied,
      exactContentPassed,
      idempotentReplayPassed,
      concurrentRevokeUsePassed,
      afterExpiryDenied,
      breakGlassReviewPassed,
      immutableAuditPassed,
      cleanupPassed: true,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      error:
        error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : "APPWRITE_G4_PLATFORM_ACCESS_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
