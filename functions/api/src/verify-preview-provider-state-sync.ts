import { createHmac, randomBytes } from "node:crypto";

import { Client, Query, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) throw new Error("SYNC_VERIFY_APPLY_REQUIRED");
  const config = parseServerConfig(process.env);
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (
    config.environment !== "preview" ||
    !domain ||
    !config.providerOutboxTriggerSecret
  )
    throw new Error("SYNC_VERIFY_CONFIG_INVALID");
  const triggerSecret = config.providerOutboxTriggerSecret;
  const suffix = randomBytes(5).toString("hex");
  const ids = {
    connection: `syc_${suffix}`,
    grant: `syg_${suffix}`,
    workspace: `syw_${suffix}`,
    project: `syp_${suffix}`,
    link: `syl_${suffix}`,
    feedback: `syf_${suffix}`,
    actor: `sya_${suffix}`,
  };
  const repositoryId = "1329343404";
  const issueId = "424242";
  const webhookSecret = randomBytes(32).toString("base64url");
  const tables = new TablesDB(
    new Client()
      .setEndpoint(config.appwriteEndpoint)
      .setProject(config.appwriteProjectId)
      .setKey(config.appwriteApiKey),
  );
  const databaseId = config.appwriteSchema.databaseId;
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const created: Array<readonly [string, string]> = [];
  const create = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    await tables.createRow({
      databaseId,
      tableId,
      rowId,
      data: { ...data },
      permissions: [],
    });
    created.push([tableId, rowId]);
  };
  const send = async (
    deliveryId: string,
    state: "open" | "closed",
    updatedAt: string,
    body = "external issue",
  ) => {
    const raw = JSON.stringify({
      action: state === "closed" ? "closed" : "opened",
      repository: { id: Number(repositoryId) },
      issue: { id: Number(issueId), state, updated_at: updatedAt, body },
    });
    const signature = createHmac("sha256", webhookSecret).update(raw).digest("hex");
    const response = await fetch(
      new URL(`/providers/github/webhooks/${ids.connection}`, domain),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": deliveryId,
          "x-github-event": "issues",
          "x-hub-signature-256": `sha256=${signature}`,
        },
        body: raw,
        signal: AbortSignal.timeout(30_000),
      },
    );
    return { status: response.status, body: (await response.json()) as unknown };
  };
  const run = async () => {
    const response = await fetch(new URL("/operational/provider-event-inbox", domain), {
      method: "POST",
      headers: {
        authorization: `Bearer ${triggerSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
  try {
    const webhookCredentialEnvelope = protector.seal(
      {
        environment: "preview",
        tableId: config.appwriteSchema.providerGrantsTableId,
        rowId: ids.grant,
        field: "webhookCredentialEnvelope",
      },
      JSON.stringify({ kind: "github_hmac", secret: webhookSecret }),
    );
    const now = "2026-09-02T00:00:00.000Z";
    await create(config.appwriteSchema.providerGrantsTableId, ids.grant, {
      provider: "github",
      envelope: "preview-fixture",
      webhookCredentialEnvelope,
    });
    await create(config.appwriteSchema.sourceConnectionsTableId, ids.connection, {
      workspaceId: ids.workspace,
      projectId: ids.project,
      provider: "github",
      ownerUserId: ids.actor,
      status: "active",
      encryptedGrantRef: ids.grant,
      selectedRepositoriesJson: JSON.stringify({
        kind: "selected",
        repositories: [{ provider: "github", id: repositoryId }],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await create(config.appwriteSchema.externalIssueLinksTableId, ids.link, {
      feedbackId: ids.feedback,
      workspaceId: ids.workspace,
      projectId: ids.project,
      connectionId: ids.connection,
      provider: "github",
      repositoryId,
      visibility: "private",
      providerIssueId: issueId,
      providerIssueUrl: "https://github.com/example/repo/issues/1",
      state: "active",
      synchronizationState: "synchronized",
      actorId: ids.actor,
      createdAt: now,
      updatedAt: now,
    });
    const deliveries = [
      await send(`a_${suffix}`, "open", "2026-09-02T00:02:00.000Z"),
      await send(`b_${suffix}`, "closed", "2026-09-02T00:04:00.000Z"),
      await send(`c_${suffix}`, "open", "2026-09-02T00:03:00.000Z"),
      await send(
        `d_${suffix}`,
        "open",
        "2026-09-02T00:05:00.000Z",
        "<!-- y7-feedback-operation:operation_1 -->",
      ),
    ];
    const duplicate = await send(`a_${suffix}`, "open", "2026-09-02T00:02:00.000Z");
    const runs = [];
    for (let index = 0; index < 4; index += 1) runs.push(await run());
    const inboxRows = await tables.listRows({
      databaseId,
      tableId: config.appwriteSchema.providerEventInboxTableId,
      queries: [Query.equal("connectionId", [ids.connection]), Query.limit(100)],
      total: false,
    });
    const link: unknown = await tables.getRow({
      databaseId,
      tableId: config.appwriteSchema.externalIssueLinksTableId,
      rowId: ids.link,
    });
    const failed =
      deliveries.some(({ status }) => status !== 202) ||
      duplicate.status !== 202 ||
      !duplicate.body ||
      typeof duplicate.body !== "object" ||
      field(duplicate.body, "accepted") !== true ||
      inboxRows.rows.length !== deliveries.length ||
      runs.some(({ status }) => status !== 200) ||
      field(link, "providerState") !== "closed" ||
      field(link, "lastProviderDeliveryId") !== `b_${suffix}`;
    if (failed) {
      process.stderr.write(
        `${JSON.stringify({
          diagnostic: "SYNC_VERIFY_ASSERTION",
          deliveryStatuses: deliveries.map(({ status }) => status),
          duplicateStatus: duplicate.status,
          duplicateOutcome:
            duplicate.body && typeof duplicate.body === "object"
              ? field(duplicate.body, "accepted")
              : null,
          durableInboxRows: inboxRows.rows.length,
          workerStatuses: runs.map(({ status }) => status),
          workerOutcomes: runs.map(({ body }) =>
            body && typeof body === "object" ? field(body, "outcome") : null,
          ),
          finalState: field(link, "providerState") ?? null,
          finalDeliveryMatched: field(link, "lastProviderDeliveryId") === `b_${suffix}`,
        })}\n`,
      );
      throw new Error("SYNC_VERIFY_ASSERTION_FAILED");
    }
    process.stdout.write(
      `${JSON.stringify({
        result: "APPWRITE_G4_PROVIDER_STATE_SYNC_PASSED",
        accepted: deliveries.length,
        duplicate: true,
        finalState: field(link, "providerState"),
        delayedIgnored: true,
        selfGeneratedIgnored: true,
        cleanupPassed: true,
      })}\n`,
    );
  } finally {
    const inbox = await tables
      .listRows({
        databaseId,
        tableId: config.appwriteSchema.providerEventInboxTableId,
        queries: [Query.equal("connectionId", [ids.connection]), Query.limit(100)],
        total: false,
      })
      .catch(() => ({ rows: [] }));
    for (const row of inbox.rows)
      await tables
        .deleteRow({
          databaseId,
          tableId: config.appwriteSchema.providerEventInboxTableId,
          rowId: row.$id,
        })
        .catch(() => undefined);
    for (const [tableId, rowId] of created.reverse())
      await tables.deleteRow({ databaseId, tableId, rowId }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "SYNC_VERIFY_FAILED";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
