import { randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwriteOutboxStore } from "./appwrite-outbox-store.js";
import {
  evaluateG3ComposedEvidence,
  type G3ComposedStep,
  type G3ResidueKind,
} from "./g3-composed-gate.js";
import { createOutboxWorker } from "./outbox.js";
import { closeProviderIssue } from "./provider-issue-cleanup.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

interface RetainedSourceState {
  readonly provider: "github" | "gitlab";
  readonly userId: string;
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly repositoryId: string;
}

interface Row extends Readonly<Record<string, unknown>> {
  readonly $id: string;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function statePath(): string {
  const path = argument("state-file");
  if (!path?.startsWith("/tmp/y7-source-") || !path.endsWith(".json")) {
    throw new Error("G3_COMPOSED_STATE_PATH_INVALID");
  }
  return path;
}

function retained(value: unknown): RetainedSourceState {
  if (
    !object(value) ||
    (value.provider !== "github" && value.provider !== "gitlab") ||
    typeof value.userId !== "string" ||
    typeof value.membershipId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.connectionId !== "string" ||
    typeof value.repositoryId !== "string"
  ) {
    throw new Error("G3_COMPOSED_STATE_INVALID");
  }
  return value as unknown as RetainedSourceState;
}

async function json(response: Response): Promise<Readonly<Record<string, unknown>>> {
  const value: unknown = await response.json();
  if (!object(value)) throw new Error("G3_COMPOSED_RESPONSE_INVALID");
  return value;
}

function absent(error: unknown): boolean {
  return object(error) && Number(error.code) === 404;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("G3_COMPOSED_APPLY_REQUIRED");
  }
  const path = statePath();
  const state = retained(JSON.parse(await readFile(path, "utf8")) as unknown);
  const config = parseServerConfig(process.env);
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (
    config.environment !== "preview" ||
    !domain ||
    !config.providerOutboxTriggerSecret
  ) {
    throw new Error("G3_COMPOSED_PREVIEW_CONFIG_REQUIRED");
  }

  const suffix = randomBytes(7).toString("hex");
  const fixtureId = `g3c_${suffix}`;
  const maintainerId = `g3cm_${suffix}`;
  const maintainerMembershipId = `g3cmm_${suffix}`;
  const assignmentId = `g3ca_${suffix}`;
  const marker = `G3 composed ${suffix}`;
  const steps: Array<{ readonly step: G3ComposedStep; readonly fixtureId: string }> =
    [];
  const createdUsers: string[] = [];
  const createdRows: Array<readonly [string, string]> = [];
  let feedbackId = "";
  let reporterId = "";
  let reference = "";
  let proof = "";
  let providerGrantRef = "";
  let issueUrl = "";
  let notificationIds: string[] = [];

  const admin = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(admin);
  const users = new Users(admin);
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const persistence = { environment: config.environment, protector };
  const record = (step: G3ComposedStep) => steps.push({ step, fixtureId });
  const request = async (
    method: "GET" | "POST",
    route: string,
    authorization: string | undefined,
    body: unknown,
    expected: number,
  ) => {
    const response = await fetch(new URL(route, domain), {
      method,
      cache: "no-store",
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await json(response);
    if (response.status !== expected) {
      throw new Error(
        `G3_COMPOSED_HTTP_${String(expected)}_GOT_${String(response.status)}_${route}_${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };
  const listFeedbackRows = async (tableId: string): Promise<Row[]> => {
    if (!feedbackId) return [];
    const result = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId,
      queries: [Query.equal("feedbackId", [feedbackId]), Query.limit(100)],
      total: false,
    });
    return result.rows;
  };
  const rememberFeedbackRows = async (tableId: string): Promise<Row[]> => {
    return listFeedbackRows(tableId);
  };

  try {
    const connection = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      rowId: state.connectionId,
    });
    const project = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.projectsTableId,
      rowId: state.projectId,
    });
    if (
      connection.status !== "active" ||
      connection.workspaceId !== state.workspaceId ||
      connection.projectId !== state.projectId ||
      typeof connection.encryptedGrantRef !== "string" ||
      typeof connection.selectedRepositoriesJson !== "string" ||
      typeof project.slug !== "string"
    ) {
      throw new Error("G3_COMPOSED_SOURCE_INVALID");
    }
    providerGrantRef = connection.encryptedGrantRef;
    const selected: unknown = JSON.parse(connection.selectedRepositoriesJson);
    const selectedImports: readonly unknown[] =
      object(selected) && Array.isArray(selected.imports)
        ? selected.imports.map((entry: unknown) => entry)
        : [];
    const imported = selectedImports.find(
      (entry) =>
        object(entry) &&
        entry.connectionId === state.connectionId &&
        entry.repositoryId === state.repositoryId &&
        entry.provider === state.provider,
    );
    if (
      !object(imported) ||
      typeof imported.owner !== "string" ||
      typeof imported.name !== "string" ||
      !["public", "private", "internal"].includes(String(imported.visibility))
    ) {
      throw new Error("G3_COMPOSED_REPOSITORY_INVALID");
    }
    const repository = {
      id: state.repositoryId,
      owner: imported.owner,
      name: imported.name,
    };
    const visibility = String(imported.visibility);

    await users.create({ userId: maintainerId, name: "G3 composed maintainer" });
    createdUsers.push(maintainerId);
    const now = new Date().toISOString();
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.workspaceMembershipsTableId,
      rowId: maintainerMembershipId,
      data: {
        workspaceId: state.workspaceId,
        userId: maintainerId,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      permissions: [],
    });
    createdRows.push([
      config.appwriteSchema.workspaceMembershipsTableId,
      maintainerMembershipId,
    ]);
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.projectAssignmentsTableId,
      rowId: assignmentId,
      data: {
        workspaceId: state.workspaceId,
        projectId: state.projectId,
        userId: maintainerId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      permissions: [],
    });
    createdRows.push([config.appwriteSchema.projectAssignmentsTableId, assignmentId]);
    const ownerSession = await users.createSession({ userId: state.userId });
    const ownerJwt = (
      await users.createJWT({
        userId: state.userId,
        sessionId: ownerSession.$id,
        duration: 900,
      })
    ).jwt;
    const maintainerSession = await users.createSession({ userId: maintainerId });
    const maintainerJwt = (
      await users.createJWT({
        userId: maintainerId,
        sessionId: maintainerSession.$id,
        duration: 900,
      })
    ).jwt;
    const accepted = await request(
      "POST",
      `/v1/projects/${encodeURIComponent(project.slug)}/feedback`,
      undefined,
      {
        clientOperationId: randomUUID(),
        locale: "fr",
        feedback: {
          type: "bug",
          source: { type: "bug", problem: marker },
          reporter: {
            kind: "contact",
            value: `g3-${suffix}@example.test`,
            purpose: "Preuve de livraison G3 Preview",
          },
          context: [],
          attachmentNames: [],
        },
      },
      201,
    );
    if (
      accepted.status !== "accepted" ||
      typeof accepted.reference !== "string" ||
      typeof accepted.accessProof !== "string"
    ) {
      throw new Error("G3_COMPOSED_INTAKE_INVALID");
    }
    reference = accepted.reference;
    proof = accepted.accessProof;
    const grants = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.accessGrantsTableId,
      queries: [Query.equal("reference", [reference]), Query.limit(2)],
      total: false,
    });
    const grant = grants.rows[0];
    if (grants.rows.length !== 1 || !grant || typeof grant.feedbackId !== "string") {
      throw new Error("G3_COMPOSED_INTAKE_FACTS_INVALID");
    }
    feedbackId = grant.feedbackId;
    const feedback = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.feedbackTableId,
      rowId: feedbackId,
    });
    if (typeof feedback.reporterId !== "string") {
      throw new Error("G3_COMPOSED_INTAKE_FACTS_INVALID");
    }
    reporterId = feedback.reporterId;

    const workbench = `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/workbench`;
    await request(
      "POST",
      `${workbench}/${feedbackId}`,
      `Bearer ${ownerJwt}`,
      {
        kind: "assign_feedback",
        operationId: `g3cas_${suffix}`,
        maintainerId,
      },
      200,
    );
    const operations = `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/operations`;
    const feed = await request(
      "POST",
      `${operations}/notifications/list`,
      `Bearer ${maintainerJwt}`,
      {},
      200,
    );
    const items =
      object(feed.data) && Array.isArray(feed.data.items) ? feed.data.items : [];
    if (
      !items.some(
        (item) =>
          object(item) &&
          item.feedbackId === feedbackId &&
          item.kind === "assignment_changed",
      )
    ) {
      throw new Error("G3_COMPOSED_SCOPED_NOTIFICATION_MISSING");
    }
    record("reporter_submission_and_scoped_notification");

    const workspaceFeedback = `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/feedback/${feedbackId}`;
    const reporterFeedback = `/v1/feedback/${feedbackId}/conversation`;
    const clarificationEventId = `g3crc_${suffix}`;
    const conversationCommand = async (
      actor: "workspace" | "reporter",
      command: Readonly<Record<string, unknown>>,
      expected = 201,
    ) =>
      request(
        "POST",
        actor === "workspace"
          ? `${workspaceFeedback}/conversation/commands`
          : `${reporterFeedback}/commands`,
        actor === "workspace" ? `Bearer ${maintainerJwt}` : `FeedbackProof ${proof}`,
        actor === "workspace" ? { command } : { reference, command },
        expected,
      );
    await conversationCommand("workspace", {
      kind: "append_internal_note",
      eventId: `g3cin_${suffix}`,
      content: "G3 composed private sentinel",
    });
    await conversationCommand("workspace", {
      kind: "append_message",
      eventId: `g3cqm_${suffix}`,
      audience: "reporter",
      content: "Quelle version est concernée ?",
    });
    await conversationCommand("workspace", {
      kind: "start_review",
      eventId: `g3csr_${suffix}`,
      expectedVersion: 1,
      reason: "Analyse commencée",
    });
    await conversationCommand("workspace", {
      kind: "request_clarification",
      eventId: clarificationEventId,
      expectedVersion: 2,
      reason: "Version nécessaire",
    });
    record("maintainer_clarification");

    const reporterProjection = await request(
      "POST",
      `${reporterFeedback}/retrieve`,
      `FeedbackProof ${proof}`,
      { reference },
      200,
    );
    if (
      JSON.stringify(reporterProjection).includes("G3 composed private sentinel") ||
      !JSON.stringify(reporterProjection).includes("Quelle version est concernée ?")
    ) {
      throw new Error("G3_COMPOSED_REPORTER_PROJECTION_INVALID");
    }
    await conversationCommand("reporter", {
      kind: "append_message",
      eventId: `g3cam_${suffix}`,
      audience: "reporter",
      content: "Version 2.1",
    });
    await conversationCommand("reporter", {
      kind: "reporter_answer",
      eventId: `g3cra_${suffix}`,
      expectedVersion: 3,
      reason: "Version 2.1",
    });
    record("reporter_answer_without_internal_notes");
    await conversationCommand("workspace", {
      kind: "resolve",
      eventId: `g3crs_${suffix}`,
      expectedVersion: 4,
      reason: "Corrigé",
    });
    await conversationCommand("workspace", {
      kind: "close",
      eventId: `g3ccl_${suffix}`,
      expectedVersion: 5,
      reason: "Clôturé après notification",
    });
    record("maintainer_resolution_and_closure");
    await conversationCommand("reporter", {
      kind: "reopen",
      eventId: `g3cro_${suffix}`,
      expectedVersion: 6,
      reason: "Le problème persiste",
    });
    record("valid_reporter_reopen");

    const feedbackBeforeFailure = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.feedbackTableId,
      rowId: feedbackId,
    });
    const lifecycleBeforeFailure = JSON.stringify(
      await listFeedbackRows(config.appwriteSchema.conversationLifecycleTableId),
    );
    const notifications = await rememberFeedbackRows(
      config.appwriteSchema.notificationsTableId,
    );
    notificationIds = notifications.map((row) => row.$id);
    const outboxes = (
      await Promise.all(
        notificationIds.map(async (notificationId) => {
          const rows = await tables.listRows({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.outboxTableId,
            queries: [Query.equal("notificationId", [notificationId]), Query.limit(2)],
            total: false,
          });
          return rows.rows;
        }),
      )
    ).flat();
    const clarificationNotificationIds = new Set(
      notifications
        .filter((row) => row.eventId === clarificationEventId)
        .map((row) => row.$id),
    );
    const retryCandidate = outboxes.find(
      (row) =>
        row.status === "pending" &&
        typeof row.notificationId === "string" &&
        clarificationNotificationIds.has(row.notificationId),
    );
    if (!retryCandidate) throw new Error("G3_COMPOSED_OUTBOX_MISSING");
    let clock = new Date();
    let delivery = 0;
    const worker = createOutboxWorker({
      store: createNodeAppwriteOutboxStore(
        tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          outboxTableId: config.appwriteSchema.outboxTableId,
        },
        persistence,
        new Set([retryCandidate.$id]),
      ),
      sender: {
        deliver: () => Promise.resolve(delivery++ === 0 ? "retryable" : "delivered"),
      },
      workerId: `g3worker_${suffix}`,
      createLeaseToken: () => `g3lease_${randomBytes(8).toString("hex")}`,
      now: () => clock,
      leaseDurationMs: 30_000,
      retryDelayMs: () => 1_000,
      maximumAttempts: 3,
      log: () => undefined,
    });
    const failed = await worker.runOnce();
    const feedbackAfterFailure = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.feedbackTableId,
      rowId: feedbackId,
    });
    const lifecycleAfterFailure = JSON.stringify(
      await listFeedbackRows(config.appwriteSchema.conversationLifecycleTableId),
    );
    if (
      failed.status !== "retry_scheduled" ||
      feedbackAfterFailure.state !== feedbackBeforeFailure.state ||
      lifecycleAfterFailure !== lifecycleBeforeFailure
    ) {
      throw new Error("G3_COMPOSED_NOTIFICATION_FAILURE_CHANGED_FACTS");
    }
    clock = new Date(clock.getTime() + 2_000);
    const reconciled = await worker.runOnce();
    if (reconciled.status !== "delivered" || reconciled.attempt !== 2) {
      throw new Error("G3_COMPOSED_NOTIFICATION_RECONCILIATION_FAILED");
    }
    record("notification_failure_and_reconciliation");

    await request(
      "POST",
      `${workbench}/${feedbackId}`,
      `Bearer ${ownerJwt}`,
      { kind: "unassign_feedback", operationId: `g3cun_${suffix}` },
      200,
    );
    await request(
      "GET",
      `${workbench}/${feedbackId}`,
      `Bearer ${maintainerJwt}`,
      undefined,
      404,
    );
    record("assignment_removal_ends_access");

    let consentVersion: number | undefined;
    if (visibility === "public") {
      const consent = await request(
        "POST",
        "/v1/feedback/publication-consent/grant",
        `FeedbackProof ${proof}`,
        {
          operationId: `g3ccg_${suffix}`,
          reference,
          disclosureVersion: "reporter-content-v1",
          audience: `${state.provider}:${state.repositoryId}`,
        },
        201,
      );
      if (!object(consent.consent) || typeof consent.consent.version !== "number") {
        throw new Error("G3_COMPOSED_CONSENT_INVALID");
      }
      consentVersion = consent.consent.version;
    }
    const issueRoute = `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/feedback/${feedbackId}/external-issue-link`;
    const issueBody = {
      operationId: `g3cil_${suffix}`,
      connectionId: state.connectionId,
      repositoryId: state.repositoryId,
      ...(consentVersion === undefined ? {} : { consentVersion }),
    };
    const linked = await request(
      "POST",
      issueRoute,
      `Bearer ${ownerJwt}`,
      issueBody,
      201,
    );
    if (linked.status !== "accepted") throw new Error("G3_COMPOSED_ISSUE_INVALID");
    await request(
      "POST",
      issueRoute,
      `Bearer ${ownerJwt}`,
      { ...issueBody, operationId: `g3cil2_${suffix}` },
      409,
    );
    const delivered = await request(
      "POST",
      "/operational/provider-issue-outbox",
      `Bearer ${config.providerOutboxTriggerSecret}`,
      {},
      200,
    );
    if (delivered.status !== "delivered") {
      throw new Error("G3_COMPOSED_PROVIDER_DELIVERY_INVALID");
    }
    const links = await rememberFeedbackRows(
      config.appwriteSchema.externalIssueLinksTableId,
    );
    if (
      links.length !== 1 ||
      links[0]?.synchronizationState !== "synchronized" ||
      typeof links[0].providerIssueUrl !== "string"
    ) {
      throw new Error("G3_COMPOSED_ISSUE_PROJECTION_INVALID");
    }
    issueUrl = links[0].providerIssueUrl;
    await closeProviderIssue({
      tables,
      databaseId: config.appwriteSchema.databaseId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
      providerGrantEnvelopeKey: config.providerGrantEnvelopeKey,
      provider: state.provider,
      providerGrantRef,
      repository,
      issueUrl,
      gitlabOrigin: process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
    });
    record("single_selected_repository_issue");
  } finally {
    const cleanupNotifications = await listFeedbackRows(
      config.appwriteSchema.notificationsTableId,
    ).catch(() => []);
    notificationIds = [
      ...new Set([...notificationIds, ...cleanupNotifications.map((row) => row.$id)]),
    ];
    const feedbackTables = [
      config.appwriteSchema.providerOutboxTableId,
      config.appwriteSchema.externalIssueLinksTableId,
      config.appwriteSchema.publicationConsentsTableId,
      config.appwriteSchema.conversationIdempotencyTableId,
      config.appwriteSchema.conversationLifecycleTableId,
      config.appwriteSchema.conversationInternalNotesTableId,
      config.appwriteSchema.conversationMessagesTableId,
      config.appwriteSchema.idempotencyTableId,
      config.appwriteSchema.lifecycleTableId,
      config.appwriteSchema.notificationsTableId,
    ];
    for (const tableId of feedbackTables) {
      const rows = await listFeedbackRows(tableId).catch(() => []);
      for (const row of rows) {
        await tables
          .deleteRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId,
            rowId: row.$id,
          })
          .catch(() => undefined);
      }
    }
    if (notificationIds.length > 0) {
      for (const notificationId of notificationIds) {
        const rows = await tables
          .listRows({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.outboxTableId,
            queries: [
              Query.equal("notificationId", [notificationId]),
              Query.limit(100),
            ],
            total: false,
          })
          .then((value) => value.rows as Row[])
          .catch(() => []);
        for (const row of rows) {
          await tables
            .deleteRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId: config.appwriteSchema.outboxTableId,
              rowId: row.$id,
            })
            .catch(() => undefined);
        }
      }
    }
    for (const recipientId of [maintainerId, state.userId]) {
      if (recipientId) {
        const signals = await tables
          .listRows({
            databaseId: config.appwriteSchema.databaseId,
            tableId: config.appwriteSchema.notificationSignalsTableId,
            queries: [Query.equal("recipientId", [recipientId]), Query.limit(100)],
            total: false,
          })
          .then((value) => value.rows as Row[])
          .catch(() => []);
        for (const row of signals) {
          await tables
            .deleteRow({
              databaseId: config.appwriteSchema.databaseId,
              tableId: config.appwriteSchema.notificationSignalsTableId,
              rowId: row.$id,
            })
            .catch(() => undefined);
        }
      }
    }
    for (const [tableId, rowId] of createdRows.reverse()) {
      await tables
        .deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        })
        .catch(() => undefined);
    }
    for (const [tableId, rowId] of [
      [config.appwriteSchema.accessGrantsTableId, feedbackId],
      [config.appwriteSchema.feedbackTableId, feedbackId],
      [config.appwriteSchema.reportersTableId, reporterId],
      [config.appwriteSchema.sourceConnectionsTableId, state.connectionId],
      [config.appwriteSchema.providerGrantsTableId, providerGrantRef],
      [config.appwriteSchema.workspaceMembershipsTableId, state.membershipId],
      [config.appwriteSchema.projectsTableId, state.projectId],
    ] as const) {
      if (!rowId) continue;
      await tables
        .deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId,
          rowId,
        })
        .catch(() => undefined);
    }
    for (const userId of [...createdUsers, state.userId]) {
      await users.delete({ userId }).catch(() => undefined);
    }
    await unlink(path).catch(() => undefined);
  }

  const countDirect = async (tableId: string, rowId: string) => {
    if (!rowId) return 0;
    try {
      await tables.getRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        rowId,
      });
      return 1;
    } catch (error: unknown) {
      if (absent(error)) return 0;
      throw error;
    }
  };
  const countFeedback = async (tableId: string) =>
    (await listFeedbackRows(tableId)).length;
  const countSignals = async (recipientId: string) =>
    (
      await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.notificationSignalsTableId,
        queries: [Query.equal("recipientId", [recipientId]), Query.limit(1)],
        total: false,
      })
    ).rows.length;
  const countUser = async (userId: string) => {
    try {
      await users.get({ userId });
      return 1;
    } catch (error: unknown) {
      if (absent(error)) return 0;
      throw error;
    }
  };
  const residue: Array<{ readonly kind: G3ResidueKind; readonly count: number }> = [
    {
      kind: "feedback",
      count: await countDirect(config.appwriteSchema.feedbackTableId, feedbackId),
    },
    {
      kind: "intake_idempotency",
      count: await countFeedback(config.appwriteSchema.idempotencyTableId),
    },
    {
      kind: "access_grants",
      count: await countDirect(config.appwriteSchema.accessGrantsTableId, feedbackId),
    },
    {
      kind: "reporters",
      count: await countDirect(config.appwriteSchema.reportersTableId, reporterId),
    },
    {
      kind: "lifecycle",
      count: await countFeedback(config.appwriteSchema.lifecycleTableId),
    },
    {
      kind: "messages",
      count: await countFeedback(config.appwriteSchema.conversationMessagesTableId),
    },
    {
      kind: "internal_notes",
      count: await countFeedback(
        config.appwriteSchema.conversationInternalNotesTableId,
      ),
    },
    {
      kind: "conversation_idempotency",
      count: await countFeedback(config.appwriteSchema.conversationIdempotencyTableId),
    },
    {
      kind: "workbench_idempotency",
      count: await countFeedback(config.appwriteSchema.conversationIdempotencyTableId),
    },
    {
      kind: "notifications",
      count: await countFeedback(config.appwriteSchema.notificationsTableId),
    },
    {
      kind: "notification_signals",
      count: (await countSignals(maintainerId)) + (await countSignals(state.userId)),
    },
    {
      kind: "notification_delivery_attempts",
      count: notificationIds.length
        ? (
            await Promise.all(
              notificationIds.map(
                async (notificationId) =>
                  (
                    await tables.listRows({
                      databaseId: config.appwriteSchema.databaseId,
                      tableId: config.appwriteSchema.outboxTableId,
                      queries: [
                        Query.equal("notificationId", [notificationId]),
                        Query.limit(1),
                      ],
                      total: false,
                    })
                  ).rows.length,
              ),
            )
          ).reduce((sum, count) => sum + count, 0)
        : 0,
    },
    {
      kind: "publication_consents",
      count: await countFeedback(config.appwriteSchema.publicationConsentsTableId),
    },
    {
      kind: "external_issue_links",
      count: await countFeedback(config.appwriteSchema.externalIssueLinksTableId),
    },
    {
      kind: "provider_outbox",
      count: await countFeedback(config.appwriteSchema.providerOutboxTableId),
    },
    {
      kind: "source_connections",
      count: await countDirect(
        config.appwriteSchema.sourceConnectionsTableId,
        state.connectionId,
      ),
    },
    {
      kind: "provider_grants",
      count: await countDirect(
        config.appwriteSchema.providerGrantsTableId,
        providerGrantRef,
      ),
    },
    {
      kind: "project_assignments",
      count: await countDirect(
        config.appwriteSchema.projectAssignmentsTableId,
        assignmentId,
      ),
    },
    {
      kind: "workspace_memberships",
      count:
        (await countDirect(
          config.appwriteSchema.workspaceMembershipsTableId,
          maintainerMembershipId,
        )) +
        (await countDirect(
          config.appwriteSchema.workspaceMembershipsTableId,
          state.membershipId,
        )),
    },
    {
      kind: "projects",
      count: await countDirect(config.appwriteSchema.projectsTableId, state.projectId),
    },
    {
      kind: "users",
      count: (await countUser(maintainerId)) + (await countUser(state.userId)),
    },
  ];
  record("fixture_cleanup");
  const result = evaluateG3ComposedEvidence({ fixtureId, steps, residue });
  process.stdout.write(
    `${JSON.stringify({ ...result, provider: state.provider, providerIssueClosed: true })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      code: error instanceof Error ? error.message : "G3_COMPOSED_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
