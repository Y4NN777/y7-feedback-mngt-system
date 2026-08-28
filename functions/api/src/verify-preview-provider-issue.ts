import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

import { Client, Query, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";
import { issueMarker } from "./provider-issue.js";
import { hashAccessProof } from "./proof-crypto.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

interface RetainedSourceState {
  readonly provider: "github" | "gitlab";
  readonly jwt: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly repositoryId: string;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function statePath(): string {
  const path = argument("state-file");
  if (!path?.startsWith("/tmp/y7-source-") || !path.endsWith(".json")) {
    throw new Error("ISSUE_VERIFY_STATE_PATH_INVALID");
  }
  return path;
}

function retained(value: unknown): RetainedSourceState {
  if (
    !object(value) ||
    (value.provider !== "github" && value.provider !== "gitlab") ||
    typeof value.jwt !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.membershipId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.connectionId !== "string" ||
    typeof value.repositoryId !== "string"
  ) {
    throw new Error("ISSUE_VERIFY_STATE_INVALID");
  }
  return value as unknown as RetainedSourceState;
}

async function responseBody(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const value: unknown = await response.json();
  if (!object(value)) throw new Error("ISSUE_VERIFY_RESPONSE_INVALID");
  return value;
}

async function closeProviderIssue(input: {
  readonly tables: TablesDB;
  readonly databaseId: string;
  readonly providerGrantsTableId: string;
  readonly providerGrantEnvelopeKey: string;
  readonly provider: "github" | "gitlab";
  readonly providerGrantRef: string;
  readonly repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
  };
  readonly operationId: string;
  readonly gitlabOrigin: string;
}): Promise<void> {
  const material = await createAppwriteProviderGrantVault(
    {
      createRow: (request) =>
        input.tables.createRow({ ...request, permissions: [...request.permissions] }),
      getRow: (request) => input.tables.getRow(request),
      deleteRow: (request) => input.tables.deleteRow(request),
    },
    {
      databaseId: input.databaseId,
      providerGrantsTableId: input.providerGrantsTableId,
    },
    Buffer.from(input.providerGrantEnvelopeKey, "base64url"),
  ).open(input.provider, input.providerGrantRef);
  const marker = issueMarker(input.operationId);
  if (input.provider === "github") {
    const search = new URL("https://api.github.com/search/issues");
    search.search = new URLSearchParams({
      q: `repo:${input.repository.owner}/${input.repository.name} "${marker}"`,
      per_page: "2",
    }).toString();
    const searched = await fetch(search, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${material.accessToken}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await responseBody(searched);
    const items = Array.isArray(body.items) ? (body.items as readonly unknown[]) : [];
    const match = items.find(
      (item) =>
        object(item) && typeof item.body === "string" && item.body.includes(marker),
    );
    if (searched.status !== 200 || !object(match) || typeof match.number !== "number") {
      throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
    }
    const closed = await fetch(
      new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.name)}/issues/${String(match.number)}`,
      ),
      {
        method: "PATCH",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${material.accessToken}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (closed.status !== 200) throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
    return;
  }
  const origin = new URL(input.gitlabOrigin.replace(/\/?$/u, "/"));
  const issuePath = `api/v4/projects/${encodeURIComponent(input.repository.id)}/issues`;
  const search = new URL(issuePath, origin);
  search.search = new URLSearchParams({
    scope: "all",
    state: "all",
    search: marker,
    in: "description",
    per_page: "2",
  }).toString();
  const searched = await fetch(search, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${material.accessToken}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await searched.json();
  const match = Array.isArray(body)
    ? (body as readonly unknown[]).find(
        (item) =>
          object(item) &&
          typeof item.description === "string" &&
          item.description.includes(marker),
      )
    : undefined;
  if (searched.status !== 200 || !object(match) || typeof match.iid !== "number") {
    throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
  }
  const closed = await fetch(new URL(`${issuePath}/${String(match.iid)}`, origin), {
    method: "PUT",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${material.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state_event: "close" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (closed.status !== 200) throw new Error("ISSUE_VERIFY_PROVIDER_CLEANUP_FAILED");
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("ISSUE_VERIFY_APPLY_REQUIRED");
  }
  const path = statePath();
  const state = retained(JSON.parse(await readFile(path, "utf8")) as unknown);
  const config = parseServerConfig(process.env);
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (
    config.environment !== "preview" ||
    !domain ||
    !config.providerOutboxTriggerSecret ||
    !config.providers
  ) {
    throw new Error("ISSUE_VERIFY_PREVIEW_CONFIG_REQUIRED");
  }
  const suffix = randomBytes(7).toString("hex");
  const feedbackId = `isf_${suffix}`;
  const minimalFeedbackId = `ism_${suffix}`;
  const reporterId = `isr_${suffix}`;
  const maintainerId = `isu_${suffix}`;
  const maintainerMembershipId = `ismb_${suffix}`;
  const reference = `Y7-ISSUE-${suffix.toUpperCase()}`;
  const minimalReference = `Y7-MIN-${suffix.toUpperCase()}`;
  const proof = `proof_${randomBytes(32).toString("base64url")}`;
  const minimalProof = `proof_${randomBytes(32).toString("base64url")}`;
  const createdRows: Array<readonly [string, string]> = [];
  const createdUsers: string[] = [];
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
    createdRows.push([tableId, rowId]);
  };
  const seal = (rowId: string, field: string, value: unknown) =>
    protector.seal(
      {
        environment: config.environment,
        tableId: config.appwriteSchema.feedbackTableId,
        rowId,
        field,
      },
      JSON.stringify(value),
    );
  const request = async (pathName: string, authorization: string, body: unknown) => {
    const response = await fetch(new URL(pathName, domain), {
      method: "POST",
      cache: "no-store",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { response, body: await responseBody(response) };
  };
  const issuePath = (targetFeedbackId: string) =>
    `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/feedback/${targetFeedbackId}/external-issue-link`;
  const feedbackRows = async (tableId: string, targetFeedbackId: string) =>
    (
      await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId,
        queries: [Query.equal("feedbackId", [targetFeedbackId]), Query.limit(100)],
        total: false,
      })
    ).rows;
  let providerGrantRef: string | undefined;
  try {
    const connection = await tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      rowId: state.connectionId,
    });
    if (
      connection.status !== "active" ||
      connection.workspaceId !== state.workspaceId ||
      connection.projectId !== state.projectId ||
      typeof connection.encryptedGrantRef !== "string" ||
      typeof connection.selectedRepositoriesJson !== "string"
    ) {
      throw new Error("ISSUE_VERIFY_CONNECTION_INVALID");
    }
    providerGrantRef = connection.encryptedGrantRef;
    const selected: unknown = JSON.parse(connection.selectedRepositoriesJson);
    if (!object(selected) || !Array.isArray(selected.imports)) {
      throw new Error("ISSUE_VERIFY_CONNECTION_INVALID");
    }
    const imported = (selected.imports as readonly unknown[]).find(
      (entry) =>
        object(entry) &&
        entry.connectionId === state.connectionId &&
        entry.repositoryId === state.repositoryId &&
        entry.provider === state.provider,
    );
    if (
      !object(imported) ||
      (imported.visibility !== "public" &&
        imported.visibility !== "private" &&
        imported.visibility !== "internal")
    ) {
      throw new Error("ISSUE_VERIFY_REPOSITORY_INVALID");
    }
    const visibility = imported.visibility;
    if (typeof imported.owner !== "string" || typeof imported.name !== "string") {
      throw new Error("ISSUE_VERIFY_REPOSITORY_INVALID");
    }
    const repository = {
      id: state.repositoryId,
      owner: imported.owner,
      name: imported.name,
    };
    const now = new Date().toISOString();
    await users.create({ userId: maintainerId, name: "Issue verifier unassigned" });
    createdUsers.push(maintainerId);
    const session = await users.createSession({ userId: maintainerId });
    const maintainerJwt = (
      await users.createJWT({
        userId: maintainerId,
        sessionId: session.$id,
        duration: 900,
      })
    ).jwt;
    await createRow(
      config.appwriteSchema.workspaceMembershipsTableId,
      maintainerMembershipId,
      {
        workspaceId: state.workspaceId,
        userId: maintainerId,
        role: "project_maintainer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    );
    for (const [targetFeedbackId, targetReference, targetProof] of [
      [feedbackId, reference, proof],
      [minimalFeedbackId, minimalReference, minimalProof],
    ] as const) {
      await createRow(config.appwriteSchema.feedbackTableId, targetFeedbackId, {
        projectId: state.projectId,
        workspaceId: state.workspaceId,
        reporterId,
        type: "bug",
        originalSourceJson: seal(targetFeedbackId, "originalSourceJson", {
          type: "bug",
          problem: "Allowed provider issue verification content",
        }),
        currentSourceJson: seal(targetFeedbackId, "currentSourceJson", {
          type: "bug",
          problem: "Allowed provider issue verification content",
        }),
        contextJson: seal(targetFeedbackId, "contextJson", []),
        attachmentNamesJson: seal(targetFeedbackId, "attachmentNamesJson", []),
        state: "received",
        acceptedAt: now,
        reporterHistoryJson: seal(targetFeedbackId, "reporterHistoryJson", []),
        reporterMessagesJson: seal(targetFeedbackId, "reporterMessagesJson", []),
        reporterAttachmentsJson: seal(targetFeedbackId, "reporterAttachmentsJson", []),
        sourceRevisionsJson: seal(targetFeedbackId, "sourceRevisionsJson", []),
        deletionRequestsJson: seal(targetFeedbackId, "deletionRequestsJson", []),
        internalNotesJson: seal(targetFeedbackId, "internalNotesJson", []),
        workspaceClassification: null,
      });
      await createRow(config.appwriteSchema.accessGrantsTableId, targetFeedbackId, {
        feedbackId: targetFeedbackId,
        reference: targetReference,
        verifier: protector.seal(
          {
            environment: config.environment,
            tableId: config.appwriteSchema.accessGrantsTableId,
            rowId: targetFeedbackId,
            field: "verifier",
          },
          hashAccessProof(targetProof),
        ),
        generation: 1,
        status: "active",
      });
    }

    const unassigned = await request(issuePath(feedbackId), `Bearer ${maintainerJwt}`, {
      operationId: `iun_${suffix}`,
      connectionId: state.connectionId,
      repositoryId: state.repositoryId,
    });
    if (unassigned.response.status !== 404) {
      throw new Error("ISSUE_VERIFY_UNASSIGNED_NOT_DENIED");
    }
    const unselected = await request(issuePath(feedbackId), `Bearer ${state.jwt}`, {
      operationId: `ius_${suffix}`,
      connectionId: state.connectionId,
      repositoryId: `missing_${suffix}`,
    });
    if (unselected.response.status !== 404) {
      throw new Error("ISSUE_VERIFY_UNSELECTED_NOT_DENIED");
    }

    let consentVersion: number | undefined;
    if (visibility === "public") {
      const noConsent = await request(
        issuePath(minimalFeedbackId),
        `Bearer ${state.jwt}`,
        {
          operationId: `imn_${suffix}`,
          connectionId: state.connectionId,
          repositoryId: state.repositoryId,
        },
      );
      if (noConsent.response.status !== 201) {
        throw new Error("ISSUE_VERIFY_PUBLIC_MINIMAL_LINK_FAILED");
      }
      const minimalOutbox = await feedbackRows(
        config.appwriteSchema.providerOutboxTableId,
        minimalFeedbackId,
      );
      const minimalRow: unknown = minimalOutbox[0];
      const minimalPayloadJson = object(minimalRow)
        ? minimalRow.payloadJson
        : undefined;
      const minimalPayload: unknown =
        minimalOutbox.length === 1 && typeof minimalPayloadJson === "string"
          ? parseJson(minimalPayloadJson)
          : undefined;
      if (!object(minimalPayload) || minimalPayload.reporterContent !== undefined) {
        throw new Error("ISSUE_VERIFY_PUBLIC_CONTENT_LEAK");
      }
      const consent = await request(
        "/v1/feedback/publication-consent/grant",
        `FeedbackProof ${proof}`,
        {
          operationId: `icg_${suffix}`,
          reference,
          disclosureVersion: "reporter-content-v1",
          audience: `${state.provider}:${state.repositoryId}`,
        },
      );
      const consentFact = object(consent.body.consent)
        ? consent.body.consent
        : undefined;
      if (
        consent.response.status !== 201 ||
        !consentFact ||
        typeof consentFact.version !== "number"
      ) {
        throw new Error("ISSUE_VERIFY_CONSENT_FAILED");
      }
      consentVersion = consentFact.version;
    }

    const operationId = `ilk_${suffix}`;
    const linked = await request(issuePath(feedbackId), `Bearer ${state.jwt}`, {
      operationId,
      connectionId: state.connectionId,
      repositoryId: state.repositoryId,
      ...(consentVersion === undefined ? {} : { consentVersion }),
    });
    if (linked.response.status !== 201 || linked.body.status !== "accepted") {
      throw new Error("ISSUE_VERIFY_LINK_FAILED");
    }
    const second = await request(issuePath(feedbackId), `Bearer ${state.jwt}`, {
      operationId: `ilk2_${suffix}`,
      connectionId: state.connectionId,
      repositoryId: state.repositoryId,
      ...(consentVersion === undefined ? {} : { consentVersion }),
    });
    if (second.response.status !== 409) {
      throw new Error("ISSUE_VERIFY_SECOND_LINK_NOT_DENIED");
    }
    const delivery = await request(
      "/operational/provider-issue-outbox",
      `Bearer ${config.providerOutboxTriggerSecret}`,
      {},
    );
    if (delivery.response.status !== 200 || delivery.body.status !== "delivered") {
      throw new Error("ISSUE_VERIFY_PROVIDER_DELIVERY_FAILED");
    }
    const links = await feedbackRows(
      config.appwriteSchema.externalIssueLinksTableId,
      feedbackId,
    );
    const link = links[0];
    if (
      links.length !== 1 ||
      link === undefined ||
      link.synchronizationState !== "synchronized" ||
      typeof link.providerIssueUrl !== "string"
    ) {
      throw new Error("ISSUE_VERIFY_LINK_PROJECTION_INVALID");
    }
    if (consentVersion !== undefined) {
      const revoked = await request(
        "/v1/feedback/publication-consent/revoke",
        `FeedbackProof ${proof}`,
        { operationId: `icr_${suffix}`, reference },
      );
      if (revoked.response.status !== 200) {
        throw new Error("ISSUE_VERIFY_REVOCATION_FAILED");
      }
    }
    await closeProviderIssue({
      tables,
      databaseId: config.appwriteSchema.databaseId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
      providerGrantEnvelopeKey: config.providerGrantEnvelopeKey,
      provider: state.provider,
      providerGrantRef: connection.encryptedGrantRef,
      repository,
      operationId,
      gitlabOrigin: config.providers.gitlab.origin,
    });
    process.stdout.write(
      `${JSON.stringify({
        result: "PROVIDER_G3_ISSUE_LINK_PASSED",
        provider: state.provider,
        visibility,
        oneActiveLink: true,
        unassignedDenied: true,
        unselectedDenied: true,
        consentVersioned: visibility === "public",
        providerIssueCreated: true,
        providerIssueClosed: true,
        providerIssueUrl: link.providerIssueUrl,
      })}\n`,
    );
  } finally {
    for (const targetFeedbackId of [feedbackId, minimalFeedbackId]) {
      for (const tableId of [
        config.appwriteSchema.providerOutboxTableId,
        config.appwriteSchema.externalIssueLinksTableId,
        config.appwriteSchema.publicationConsentsTableId,
      ]) {
        const rows = await feedbackRows(tableId, targetFeedbackId).catch(() => []);
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
    await tables
      .deleteRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.sourceConnectionsTableId,
        rowId: state.connectionId,
      })
      .catch(() => undefined);
    if (providerGrantRef !== undefined) {
      await tables
        .deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId: config.appwriteSchema.providerGrantsTableId,
          rowId: providerGrantRef,
        })
        .catch(() => undefined);
    }
    await tables
      .deleteRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.workspaceMembershipsTableId,
        rowId: state.membershipId,
      })
      .catch(() => undefined);
    for (const userId of [...createdUsers, state.userId]) {
      await users.delete({ userId }).catch(() => undefined);
    }
    await unlink(path).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      code: error instanceof Error ? error.message : "ISSUE_VERIFY_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
