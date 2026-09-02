import { randomBytes } from "node:crypto";

import { Client, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("APPWRITE_G4_INTELLIGENCE_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview")
    throw new Error("APPWRITE_G4_INTELLIGENCE_PREVIEW_REQUIRED");
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
  if (!domain) throw new Error("APPWRITE_G4_INTELLIGENCE_DOMAIN_REQUIRED");

  const suffix = randomBytes(6).toString("hex");
  const workspaceId = `g4iw_${suffix}`;
  const siblingWorkspaceId = `g4ix_${suffix}`;
  const projectId = `g4ip_${suffix}`;
  const siblingProjectId = `g4is_${suffix}`;
  const foreignProjectId = `g4if_${suffix}`;
  const principalId = `g4iu_${suffix}`;
  const reporters = [`g4ir_${suffix}`, `g4ie_${suffix}`, `g4iz_${suffix}`] as const;
  const feedback = [
    `g4ia_${suffix}`,
    `g4ib_${suffix}`,
    `g4ic_${suffix}`,
    `g4id_${suffix}`,
  ] as const;
  const siblingFeedbackId = `g4iy_${suffix}`;
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const users = new Users(client);
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const rows: Array<readonly [string, string]> = [];
  let userCreated = false;
  let cleanupFailure: unknown;
  const createRow = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      rowId,
      data,
      permissions: [],
    });
    rows.push([tableId, rowId]);
  };
  const seal = (tableId: string, rowId: string, field: string, value: unknown) =>
    protector.seal(
      { environment: config.environment, tableId, rowId, field },
      JSON.stringify(value),
    );
  const createFeedback = async (input: {
    readonly id: string;
    readonly targetWorkspaceId: string;
    readonly targetProjectId: string;
    readonly reporterId: string;
    readonly type: "bug" | "suggestion" | "review";
    readonly state: "received" | "under_review" | "resolved";
    readonly acceptedAt: string;
    readonly context: readonly unknown[];
    readonly deletedAt?: string;
  }) => {
    const tableId = config.appwriteSchema.feedbackTableId;
    const encrypted = (field: string, value: unknown) =>
      seal(tableId, input.id, field, value);
    await createRow(tableId, input.id, {
      workspaceId: input.targetWorkspaceId,
      projectId: input.targetProjectId,
      reporterId: input.reporterId,
      type: input.type,
      state: input.state,
      acceptedAt: input.acceptedAt,
      originalSourceJson: encrypted("originalSourceJson", {
        type: input.type,
        problem: "G4 Intelligence verifier",
      }),
      currentSourceJson: encrypted("currentSourceJson", {
        type: input.type,
        problem: "G4 Intelligence verifier",
      }),
      contextJson: encrypted("contextJson", input.context),
      attachmentNamesJson: encrypted("attachmentNamesJson", []),
      reporterHistoryJson: encrypted("reporterHistoryJson", []),
      reporterMessagesJson: encrypted("reporterMessagesJson", []),
      reporterAttachmentsJson: encrypted("reporterAttachmentsJson", []),
      sourceRevisionsJson: encrypted("sourceRevisionsJson", []),
      deletionRequestsJson: encrypted("deletionRequestsJson", []),
      internalNotesJson: encrypted("internalNotesJson", []),
      ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
    });
  };
  const request = async (
    jwt: string,
    targetWorkspaceId: string,
    targetProjectId: string,
    query: unknown,
    expectedStatus: number,
  ) => {
    const started = performance.now();
    const response = await fetch(
      new URL(
        `/v1/workspaces/${targetWorkspaceId}/projects/${targetProjectId}/intelligence`,
        domain,
      ),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(query),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body: unknown = await response.json();
    if (response.status !== expectedStatus)
      throw new Error(
        `APPWRITE_G4_INTELLIGENCE_HTTP_${String(expectedStatus)}_GOT_${String(response.status)}`,
      );
    return { body, durationMs: performance.now() - started };
  };
  const mutate = async (
    jwt: string,
    targetWorkspaceId: string,
    targetProjectId: string,
    command: unknown,
    expectedStatus: number,
  ) => {
    const response = await fetch(
      new URL(
        `/v1/workspaces/${targetWorkspaceId}/projects/${targetProjectId}/intelligence/provenance`,
        domain,
      ),
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
        `APPWRITE_G4_PROVENANCE_HTTP_${String(expectedStatus)}_GOT_${String(response.status)}`,
      );
    return body;
  };

  let filterPassed = false;
  let trendPassed = false;
  let paginationPassed = false;
  let deletedExcluded = false;
  let projectIsolationPassed = false;
  let workspaceIsolationPassed = false;
  let boundedQueryMs = 0;
  let coldStartWarmupMs = 0;
  let themeProvenancePassed = false;
  let correctionAttributionPassed = false;
  let relationshipScopePassed = false;
  try {
    await users.create({ userId: principalId, name: "G4 Intelligence verifier" });
    userCreated = true;
    const session = await users.createSession({ userId: principalId });
    const jwt = (
      await users.createJWT({
        userId: principalId,
        sessionId: session.$id,
        duration: 900,
      })
    ).jwt;
    const now = "2026-08-15T00:00:00.000Z";
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      `g4im_${suffix}`,
      {
        workspaceId,
        userId: principalId,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    for (const [id, targetWorkspaceId] of [
      [projectId, workspaceId],
      [siblingProjectId, workspaceId],
      [foreignProjectId, siblingWorkspaceId],
    ] as const)
      await createRow(config.appwriteSchema.projectsTableId, id, {
        workspaceId: targetWorkspaceId,
        slug: `g4-${id}`,
        active: true,
        enabledTypesJson: '["bug","suggestion","review"]',
        contextDeclarationsJson: "[]",
        reporterPurposeFr: "Vérification Intelligence",
        reporterPurposeEn: "Intelligence verification",
      });
    await createRow(config.appwriteSchema.projectAssignmentsTableId, `g4ia_${suffix}`, {
      workspaceId,
      projectId,
      userId: principalId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const [index, reporterId] of reporters.entries()) {
      const reporterWorkspace = index === 2 ? siblingWorkspaceId : workspaceId;
      await createRow(config.appwriteSchema.reportersTableId, reporterId, {
        workspaceId: reporterWorkspace,
        attributionJson: seal(
          config.appwriteSchema.reportersTableId,
          reporterId,
          "attributionJson",
          { kind: index === 1 ? "external" : "unidentified" },
        ),
      });
    }
    const reviewedContext = [
      { name: "applicationVersion", value: "2.1.0", trust: "verified" },
      { name: "place", value: "checkout", trust: "verified" },
      { name: "feature", value: "billing", trust: "verified" },
      { name: "untrusted", value: "must-not-filter", trust: "unverified" },
    ];
    await createFeedback({
      id: feedback[0],
      targetWorkspaceId: workspaceId,
      targetProjectId: projectId,
      reporterId: reporters[0],
      type: "suggestion",
      state: "received",
      acceptedAt: "2026-08-05T12:00:00.000Z",
      context: reviewedContext,
    });
    await createFeedback({
      id: siblingFeedbackId,
      targetWorkspaceId: workspaceId,
      targetProjectId: siblingProjectId,
      reporterId: reporters[0],
      type: "bug",
      state: "received",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      context: reviewedContext,
    });
    await createFeedback({
      id: feedback[1],
      targetWorkspaceId: workspaceId,
      targetProjectId: projectId,
      reporterId: reporters[1],
      type: "bug",
      state: "under_review",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      context: reviewedContext,
    });
    await createFeedback({
      id: feedback[2],
      targetWorkspaceId: workspaceId,
      targetProjectId: projectId,
      reporterId: reporters[0],
      type: "bug",
      state: "resolved",
      acceptedAt: "2026-08-11T12:00:00.000Z",
      context: reviewedContext,
      deletedAt: "2026-08-12T00:00:00.000Z",
    });
    await createFeedback({
      id: feedback[3],
      targetWorkspaceId: siblingWorkspaceId,
      targetProjectId: foreignProjectId,
      reporterId: reporters[2],
      type: "review",
      state: "received",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      context: reviewedContext,
    });

    const warmupStarted = performance.now();
    const warmup = await fetch(new URL("/health", domain), {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    coldStartWarmupMs = performance.now() - warmupStarted;
    if (!warmup.ok) throw new Error("APPWRITE_G4_INTELLIGENCE_WARMUP_FAILED");

    const baseQuery = {
      filter: { versions: ["2.1.0"], places: ["checkout"], features: ["billing"] },
      pageSize: 1,
      trendWindow: {
        current: { from: "2026-08-08T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
        baseline: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z" },
      },
    };
    const first = await request(jwt, workspaceId, projectId, baseQuery, 200);
    boundedQueryMs = first.durationMs;
    if (!object(first.body) || !object(first.body.result))
      throw new Error("APPWRITE_G4_INTELLIGENCE_RESULT_INVALID");
    const aggregate = first.body.result.aggregate;
    const trend = first.body.result.trend;
    const ids = first.body.result.ids;
    const cursor = first.body.result.nextCursor;
    filterPassed = object(aggregate) && aggregate.total === 2;
    deletedExcluded = filterPassed;
    trendPassed =
      object(trend) &&
      trend.currentCount === 1 &&
      trend.baselineCount === 1 &&
      trend.direction === "stable";
    if (!Array.isArray(ids) || ids.length !== 1 || typeof cursor !== "string")
      throw new Error("APPWRITE_G4_INTELLIGENCE_PAGE_INVALID");
    const second = await request(
      jwt,
      workspaceId,
      projectId,
      { ...baseQuery, cursor },
      200,
    );
    paginationPassed =
      object(second.body) &&
      object(second.body.result) &&
      Array.isArray(second.body.result.ids) &&
      second.body.result.ids.length === 1 &&
      second.body.result.nextCursor === null;
    await request(jwt, workspaceId, siblingProjectId, { filter: {} }, 404);
    projectIsolationPassed = true;
    await request(jwt, siblingWorkspaceId, foreignProjectId, { filter: {} }, 404);
    workspaceIsolationPassed = true;

    const recordBody = await mutate(
      jwt,
      workspaceId,
      projectId,
      {
        kind: "record_theme",
        operationId: `g4io1_${suffix}`,
        feedbackId: feedback[0],
        label: "Checkout friction",
      },
      200,
    );
    if (!object(recordBody) || !object(recordBody.result))
      throw new Error("APPWRITE_G4_PROVENANCE_RECORD_INVALID");
    const associationId = recordBody.result.associationId;
    if (typeof associationId !== "string")
      throw new Error("APPWRITE_G4_PROVENANCE_RECORD_INVALID");
    rows.push([config.appwriteSchema.intelligenceProvenanceTableId, associationId]);
    const replayBody = await mutate(
      jwt,
      workspaceId,
      projectId,
      {
        kind: "record_theme",
        operationId: `g4io1_${suffix}`,
        feedbackId: feedback[0],
        label: "Checkout friction",
      },
      200,
    );
    if (
      !object(replayBody) ||
      !object(replayBody.result) ||
      replayBody.result.disposition !== "replayed"
    )
      throw new Error("APPWRITE_G4_PROVENANCE_REPLAY_INVALID");
    await mutate(
      jwt,
      workspaceId,
      projectId,
      {
        kind: "correct_theme",
        operationId: `g4io2_${suffix}`,
        associationId,
        expectedRevision: 1,
        label: "Payment friction",
      },
      200,
    );
    const provenanceRow = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.intelligenceProvenanceTableId,
      rowId: associationId,
    });
    const provenance = JSON.parse(
      protector.open(
        {
          environment: config.environment,
          tableId: config.appwriteSchema.intelligenceProvenanceTableId,
          rowId: associationId,
          field: "provenanceEnvelope",
        },
        String(provenanceRow.provenanceEnvelope),
      ),
    ) as unknown;
    themeProvenancePassed =
      Array.isArray(provenance) &&
      provenance.length === 2 &&
      provenance.every(
        (event) =>
          object(event) &&
          event.feedbackId === feedback[0] &&
          event.sourceVersion === 1,
      );
    correctionAttributionPassed =
      provenanceRow.updatedByActorId === principalId && provenanceRow.revision === 2;
    await mutate(
      jwt,
      workspaceId,
      projectId,
      {
        kind: "record_relationship",
        operationId: `g4io3_${suffix}`,
        feedbackId: feedback[0],
        relatedFeedbackId: siblingFeedbackId,
        relationType: "related",
      },
      404,
    );
    relationshipScopePassed = true;
    await mutate(
      jwt,
      workspaceId,
      projectId,
      {
        kind: "remove_association",
        operationId: `g4io4_${suffix}`,
        associationId,
        expectedRevision: 2,
      },
      200,
    );
    if (boundedQueryMs > 10_000)
      throw new Error("APPWRITE_G4_INTELLIGENCE_QUERY_TOO_SLOW");
    if (
      !filterPassed ||
      !trendPassed ||
      !paginationPassed ||
      !deletedExcluded ||
      !themeProvenancePassed ||
      !correctionAttributionPassed
    )
      throw new Error("APPWRITE_G4_INTELLIGENCE_ASSERTION_FAILED");
  } finally {
    for (const [tableId, rowId] of rows.reverse()) {
      try {
        await tables.deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
    if (userCreated) {
      try {
        await users.delete({ userId: principalId });
      } catch (error: unknown) {
        if (!absent(error)) cleanupFailure ??= error;
      }
    }
  }
  if (cleanupFailure)
    throw cleanupFailure instanceof Error
      ? cleanupFailure
      : new Error("APPWRITE_G4_INTELLIGENCE_CLEANUP_FAILED");
  process.stdout.write(
    `${JSON.stringify({
      result: "APPWRITE_G4_INTELLIGENCE_PASSED",
      filterPassed,
      trendPassed,
      paginationPassed,
      deletedExcluded,
      projectIsolationPassed,
      workspaceIsolationPassed,
      boundedQueryMs: Math.round(boundedQueryMs),
      coldStartWarmupMs: Math.round(coldStartWarmupMs),
      themeProvenancePassed,
      correctionAttributionPassed,
      relationshipScopePassed,
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
          : "APPWRITE_G4_INTELLIGENCE_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
