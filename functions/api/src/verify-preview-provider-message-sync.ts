import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

import { Client, DeploymentStatus, Functions, Query, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";
import { createNodeAppwriteProviderConsentCleanup } from "./appwrite-provider-consent-cleanup.js";
import { createNodeAppwriteProviderMessageFanout } from "./appwrite-provider-message-fanout.js";
import { createGitHubMessageProvider } from "./github-message-provider.js";
import { createGitLabMessageProvider } from "./gitlab-message-provider.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";
import type { ProviderGrantVault } from "./source-provider.js";

type Provider = "github" | "gitlab";

interface Target {
  readonly provider: Provider;
  readonly connectionId: string;
  readonly grantId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly feedbackId: string;
  readonly linkId: string;
  readonly repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly visibility: "public" | "private" | "internal";
  };
  readonly user: { readonly id: string; readonly login: string };
  readonly token: string;
  readonly webhookSecret: string;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

async function json(
  response: Response,
  code: string,
): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await response.json();
  if (!object(body)) throw new Error(code);
  return body;
}

function githubToken(): string {
  const configured = process.env.Y7_GITHUB_VERIFICATION_TOKEN?.trim();
  if (configured) return configured;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("MESSAGE_SYNC_GITHUB_CREDENTIAL_REQUIRED");
  }
}

function gitlabToken(fallback?: string): string {
  const configured = process.env.Y7_GITLAB_VERIFICATION_TOKEN?.trim();
  if (configured) return configured;
  if (fallback) return fallback;
  throw new Error("MESSAGE_SYNC_GITLAB_CREDENTIAL_REQUIRED");
}

async function providerRequest(
  target: Pick<Target, "provider" | "token">,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(
    "accept",
    target.provider === "github" ? "application/vnd.github+json" : "application/json",
  );
  headers.set("authorization", `Bearer ${target.token}`);
  if (target.provider === "github") headers.set("x-github-api-version", "2022-11-28");
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("MESSAGE_SYNC_PROVIDER_REQUEST_FAILED");
  }
  return response;
}

async function target(
  provider: Provider,
  gitlabFallbackToken?: string,
): Promise<
  Omit<
    Target,
    | "connectionId"
    | "grantId"
    | "workspaceId"
    | "projectId"
    | "feedbackId"
    | "linkId"
    | "webhookSecret"
  >
> {
  if (provider === "github") {
    const token = githubToken();
    const repositoryPath =
      process.env.Y7_GITHUB_VERIFICATION_REPOSITORY?.trim() ||
      "Y4NN777/y7-feedback-mngt-system";
    const [owner, name] = repositoryPath.split("/");
    if (!owner || !name) throw new Error("MESSAGE_SYNC_GITHUB_TARGET_INVALID");
    const auth = { provider, token } as const;
    const [repository, user] = await Promise.all([
      providerRequest(
        auth,
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      ).then((response) => json(response, "MESSAGE_SYNC_GITHUB_TARGET_INVALID")),
      providerRequest(auth, "https://api.github.com/user").then((response) =>
        json(response, "MESSAGE_SYNC_GITHUB_USER_INVALID"),
      ),
    ]);
    return {
      provider,
      token,
      repository: {
        id: String(repository.id),
        owner,
        name,
        visibility: repository.private === true ? "private" : "public",
      },
      user: {
        id: String(user.id),
        login: required(user.login, "MESSAGE_SYNC_GITHUB_USER_INVALID"),
      },
    };
  }
  const token = gitlabToken(gitlabFallbackToken);
  const repositoryId =
    process.env.Y7_GITLAB_VERIFICATION_PROJECT_ID?.trim() || "83836910";
  const origin = new URL(
    process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
  );
  const auth = { provider, token } as const;
  const [repository, user] = await Promise.all([
    providerRequest(
      auth,
      new URL(`api/v4/projects/${encodeURIComponent(repositoryId)}`, origin),
    ).then((response) => json(response, "MESSAGE_SYNC_GITLAB_TARGET_INVALID")),
    providerRequest(auth, new URL("api/v4/user", origin)).then((response) =>
      json(response, "MESSAGE_SYNC_GITLAB_USER_INVALID"),
    ),
  ]);
  const path = required(
    repository.path_with_namespace,
    "MESSAGE_SYNC_GITLAB_TARGET_INVALID",
  );
  const separator = path.lastIndexOf("/");
  if (separator < 1) throw new Error("MESSAGE_SYNC_GITLAB_TARGET_INVALID");
  const visibility = repository.visibility;
  if (visibility !== "public" && visibility !== "private" && visibility !== "internal")
    throw new Error("MESSAGE_SYNC_GITLAB_TARGET_INVALID");
  return {
    provider,
    token,
    repository: {
      id: repositoryId,
      owner: path.slice(0, separator),
      name: path.slice(separator + 1),
      visibility,
    },
    user: {
      id: String(user.id),
      login: required(user.username, "MESSAGE_SYNC_GITLAB_USER_INVALID"),
    },
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply"))
    throw new Error("MESSAGE_SYNC_VERIFY_APPLY_REQUIRED");
  const providerArgument = process.argv.find((argument) =>
    argument.startsWith("--provider="),
  );
  const providerSelection = providerArgument?.slice("--provider=".length) ?? "all";
  if (
    providerSelection !== "all" &&
    providerSelection !== "github" &&
    providerSelection !== "gitlab"
  )
    throw new Error("MESSAGE_SYNC_VERIFY_PROVIDER_INVALID");
  const providers: readonly Provider[] =
    providerSelection === "all" ? ["github", "gitlab"] : [providerSelection];
  const config = parseServerConfig(process.env);
  const domain = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (config.environment !== "preview" || !domain)
    throw new Error("MESSAGE_SYNC_VERIFY_CONFIG_INVALID");
  const suffix = randomBytes(5).toString("hex");
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const functions = new Functions(client);
  const existingVault = createAppwriteProviderGrantVault(
    {
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    {
      databaseId: config.appwriteSchema.databaseId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
    },
    Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
  );
  let gitlabFallbackToken: string | undefined;
  if (
    providers.includes("gitlab") &&
    !process.env.Y7_GITLAB_VERIFICATION_TOKEN?.trim()
  ) {
    const repositoryId =
      process.env.Y7_GITLAB_VERIFICATION_PROJECT_ID?.trim() || "83836910";
    const connections = await tables.listRows({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      queries: [Query.equal("provider", ["gitlab"]), Query.limit(100)],
      total: false,
    });
    for (const row of connections.rows) {
      if (row.status !== "active" && row.status !== "selecting") continue;
      if (typeof row.encryptedGrantRef !== "string") continue;
      try {
        const selection: unknown = JSON.parse(String(row.selectedRepositoriesJson));
        if (
          !object(selection) ||
          !Array.isArray(selection.repositories) ||
          !selection.repositories.some(
            (repository) =>
              object(repository) && String(repository.id) === repositoryId,
          )
        ) {
          continue;
        }
        gitlabFallbackToken = (
          await existingVault.open("gitlab", row.encryptedGrantRef)
        ).accessToken;
        break;
      } catch {
        // Ignore malformed, expired or key-incompatible historical connections.
      }
    }
    if (!gitlabFallbackToken) {
      const grants = await tables.listRows({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.providerGrantsTableId,
        queries: [
          Query.equal("provider", ["gitlab"]),
          Query.orderDesc("$createdAt"),
          Query.limit(100),
        ],
        total: false,
      });
      const origin = new URL(
        process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
      );
      for (const row of grants.rows) {
        try {
          const candidate = (await existingVault.open("gitlab", row.$id)).accessToken;
          const [identity, repository] = await Promise.all([
            fetch(new URL("api/v4/user", origin), {
              headers: { authorization: `Bearer ${candidate}` },
              signal: AbortSignal.timeout(15_000),
            }),
            fetch(
              new URL(`api/v4/projects/${encodeURIComponent(repositoryId)}`, origin),
              {
                headers: { authorization: `Bearer ${candidate}` },
                signal: AbortSignal.timeout(15_000),
              },
            ),
          ]);
          if (identity.ok && repository.ok) {
            gitlabFallbackToken = candidate;
            break;
          }
        } catch {
          // Continue until a still-valid OAuth grant for the verification project is found.
        }
      }
    }
  }
  const functionId =
    process.env.APPWRITE_FUNCTION_ID?.trim() || "y7-feedback-api-preview";
  let triggerSecret = config.providerOutboxTriggerSecret;
  if (!triggerSecret) {
    triggerSecret = randomBytes(32).toString("base64url");
    const definition = await functions.get({ functionId });
    const variable = definition.vars.find(
      (candidate) => candidate.key === "PROVIDER_OUTBOX_TRIGGER_SECRET",
    );
    if (!variable || !definition.deploymentId)
      throw new Error("MESSAGE_SYNC_VERIFY_CONFIG_INVALID");
    await functions.updateVariable({
      functionId,
      variableId: variable.$id,
      key: variable.key,
      value: triggerSecret,
      secret: true,
    });
    const duplicate = await functions.createDuplicateDeployment({
      functionId,
      deploymentId: definition.deploymentId,
    });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const deployment = await functions.getDeployment({
        functionId,
        deploymentId: duplicate.$id,
      });
      if (deployment.status === DeploymentStatus.Ready) {
        ready = true;
        break;
      }
      if (deployment.status === DeploymentStatus.Failed)
        throw new Error("MESSAGE_SYNC_VERIFY_DEPLOYMENT_FAILED");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (!ready) throw new Error("MESSAGE_SYNC_VERIFY_DEPLOYMENT_TIMEOUT");
    await functions.updateFunctionDeployment({
      functionId,
      deploymentId: duplicate.$id,
    });
  }
  const databaseId = config.appwriteSchema.databaseId;
  const protector = createSensitiveDataProtector(
    config.sensitiveDataActiveKeyId,
    Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
      id,
      material: Buffer.from(material, "base64url"),
    })),
  );
  const persistence = { environment: "preview" as const, protector };
  const created: Array<readonly [string, string]> = [];
  const create = async (
    tableId: string,
    rowId: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    await tables.createRow({ databaseId, tableId, rowId, data, permissions: [] });
    created.push([tableId, rowId]);
  };
  const invoke = async (_path: string) => {
    const response = await fetch(new URL(_path, domain), {
      method: "POST",
      headers: {
        authorization: `Bearer ${triggerSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(90_000),
    });
    if (response.status !== 200) throw new Error("MESSAGE_SYNC_MAINTENANCE_FAILED");
    return json(response, "MESSAGE_SYNC_MAINTENANCE_FAILED");
  };
  const messageRows = async (feedbackId: string) =>
    (
      await tables.listRows({
        databaseId,
        tableId: config.appwriteSchema.conversationMessagesTableId,
        queries: [
          Query.equal("feedbackId", [feedbackId]),
          Query.orderAsc("occurredAt"),
          Query.limit(100),
        ],
        total: false,
      })
    ).rows;
  const outboxRows = async (feedbackId: string) =>
    (
      await tables.listRows({
        databaseId,
        tableId: config.appwriteSchema.providerSyncOutboxTableId,
        queries: [
          Query.equal("feedbackId", [feedbackId]),
          Query.orderAsc("sequence"),
          Query.limit(100),
        ],
        total: false,
      })
    ).rows;
  const inboxRows = async (connectionId: string) =>
    (
      await tables.listRows({
        databaseId,
        tableId: config.appwriteSchema.providerEventInboxTableId,
        queries: [Query.equal("connectionId", [connectionId]), Query.limit(100)],
        total: false,
      })
    ).rows;
  const outcomes: Array<Readonly<Record<string, unknown>>> = [];

  for (const provider of providers) {
    const discovered = await target(provider, gitlabFallbackToken);
    const ids = {
      grantId: `${provider === "github" ? "mgh" : "mgl"}_${suffix}`,
      connectionId: `${provider === "github" ? "cgh" : "cgl"}_${suffix}`,
      workspaceId: `${provider === "github" ? "wgh" : "wgl"}_${suffix}`,
      projectId: `${provider === "github" ? "pgh" : "pgl"}_${suffix}`,
      feedbackId: `${provider === "github" ? "fgh" : "fgl"}_${suffix}`,
      linkId: `${provider === "github" ? "lgh" : "lgl"}_${suffix}`,
      actorId: `${provider === "github" ? "agh" : "agl"}_${suffix}`,
    };
    const webhookSecret = randomBytes(32).toString("base64url");
    const current: Target = { ...discovered, ...ids, webhookSecret };
    let issueId: string | undefined;
    let issueUrl: string | undefined;
    let inboundCommentId: string | undefined;
    const vault: ProviderGrantVault = createAppwriteProviderGrantVault(
      {
        createRow: (input) =>
          tables.createRow({ ...input, permissions: [...input.permissions] }),
        getRow: (input) => tables.getRow(input),
        deleteRow: (input) => tables.deleteRow(input),
      },
      {
        databaseId,
        providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
      },
      Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
      { createReference: () => current.grantId, createNonce: () => randomBytes(12) },
    );
    try {
      await vault.seal(provider, { accessToken: current.token });
      created.push([config.appwriteSchema.providerGrantsTableId, current.grantId]);
      const webhookCredentialEnvelope = protector.seal(
        {
          environment: "preview",
          tableId: config.appwriteSchema.providerGrantsTableId,
          rowId: current.grantId,
          field: "webhookCredentialEnvelope",
        },
        JSON.stringify({
          kind: provider === "github" ? "github_hmac" : "gitlab_legacy",
          secret: webhookSecret,
        }),
      );
      await tables.updateRow({
        databaseId,
        tableId: config.appwriteSchema.providerGrantsTableId,
        rowId: current.grantId,
        data: { webhookCredentialEnvelope },
      });
      const now = new Date().toISOString();
      await create(
        config.appwriteSchema.sourceConnectionsTableId,
        current.connectionId,
        {
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          provider,
          ownerUserId: ids.actorId,
          status: "active",
          encryptedGrantRef: current.grantId,
          selectedRepositoriesJson: JSON.stringify({
            kind: "selected",
            repositories: [{ provider, id: current.repository.id }],
            imports: [
              {
                connectionId: current.connectionId,
                provider,
                repositoryId: current.repository.id,
                owner: current.repository.owner,
                name: current.repository.name,
                visibility: current.repository.visibility,
              },
            ],
          }),
          createdAt: now,
          updatedAt: now,
        },
      );

      if (provider === "github") {
        const createdIssue = await providerRequest(
          current,
          `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: `Y7 message sync proof ${suffix}`,
              body: "Temporary Preview verification issue.",
            }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_ISSUE_CREATE_FAILED"));
        issueId = String(createdIssue.number);
        issueUrl = required(createdIssue.html_url, "MESSAGE_SYNC_ISSUE_CREATE_FAILED");
      } else {
        const origin = new URL(
          process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
        );
        const createdIssue = await providerRequest(
          current,
          new URL(
            `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues`,
            origin,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: `Y7 message sync proof ${suffix}`,
              description: "Temporary Preview verification issue.",
            }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_ISSUE_CREATE_FAILED"));
        issueId = String(createdIssue.iid);
        issueUrl = required(createdIssue.web_url, "MESSAGE_SYNC_ISSUE_CREATE_FAILED");
      }
      await create(config.appwriteSchema.externalIssueLinksTableId, current.linkId, {
        feedbackId: current.feedbackId,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        connectionId: current.connectionId,
        provider,
        repositoryId: current.repository.id,
        visibility: current.repository.visibility,
        providerIssueId: issueId,
        providerIssueUrl: issueUrl,
        state: "active",
        synchronizationState: "synchronized",
        actorId: ids.actorId,
        createdAt: now,
        updatedAt: now,
      });

      const inboundContent = `Eligible ${provider} collaborator ${suffix}`;
      let comment: Readonly<Record<string, unknown>>;
      if (provider === "github") {
        comment = await providerRequest(
          current,
          `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues/${issueId}/comments`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: inboundContent }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_COMMENT_CREATE_FAILED"));
      } else {
        const origin = new URL(
          process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
        );
        comment = await providerRequest(
          current,
          new URL(
            `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues/${issueId}/notes`,
            origin,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: inboundContent }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_COMMENT_CREATE_FAILED"));
      }
      inboundCommentId = String(comment.id);
      const sendWebhook = async (
        deliveryId: string,
        mutation: "created" | "revised",
        content: string,
        updatedAt: string,
        author = current.user,
        commentId = inboundCommentId,
      ) => {
        const raw =
          provider === "github"
            ? JSON.stringify({
                action: mutation === "created" ? "created" : "edited",
                repository: { id: Number(current.repository.id) },
                issue: { number: Number(issueId) },
                comment: {
                  id: Number(commentId),
                  body: content,
                  updated_at: updatedAt,
                  user: { id: Number(author.id), login: author.login },
                },
              })
            : JSON.stringify({
                object_kind: "note",
                event_type: mutation === "created" ? "create" : "update",
                project: { id: Number(current.repository.id) },
                user: { id: Number(author.id), username: author.login },
                issue: { iid: Number(issueId) },
                object_attributes: {
                  id: Number(commentId),
                  action: mutation === "created" ? "create" : "update",
                  note: content,
                  noteable_type: "Issue",
                  updated_at: updatedAt,
                },
              });
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (provider === "github") {
          headers["x-github-delivery"] = deliveryId;
          headers["x-github-event"] = "issue_comment";
          headers["x-hub-signature-256"] =
            `sha256=${createHmac("sha256", webhookSecret).update(raw).digest("hex")}`;
        } else {
          headers["x-gitlab-event"] = "Note Hook";
          headers["x-gitlab-token"] = webhookSecret;
          headers["idempotency-key"] = deliveryId;
        }
        const response = await fetch(
          new URL(`/providers/${provider}/webhooks/${current.connectionId}`, domain),
          {
            method: "POST",
            headers,
            body: raw,
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (response.status !== 202) throw new Error("MESSAGE_SYNC_WEBHOOK_FAILED");
      };
      const createdAt = required(
        comment.updated_at ?? comment.created_at,
        "MESSAGE_SYNC_COMMENT_INVALID",
      );
      await sendWebhook(
        `msg_create_${suffix}_${provider}`,
        "created",
        inboundContent,
        createdAt,
      );
      await sendWebhook(
        `msg_create_${suffix}_${provider}`,
        "created",
        inboundContent,
        createdAt,
      );
      await invoke("/operational/provider-event-inbox");
      let messages = await messageRows(current.feedbackId);
      if (messages.length !== 1 || messages[0]?.revisionKind !== "created") {
        const inbox = await inboxRows(current.connectionId);
        process.stderr.write(
          `${JSON.stringify({
            diagnostic: "inbound_create",
            messageCount: messages.length,
            inbox: inbox.map((row: unknown) =>
              object(row)
                ? {
                    status: typeof row.status === "string" ? row.status : "unknown",
                    attempts: typeof row.attempts === "number" ? row.attempts : null,
                    lastErrorCode:
                      typeof row.lastErrorCode === "string" ? row.lastErrorCode : null,
                  }
                : { status: "invalid", attempts: null, lastErrorCode: null },
            ),
          })}\n`,
        );
        throw new Error("MESSAGE_SYNC_INBOUND_CREATE_FAILED");
      }
      if ((await inboxRows(current.connectionId)).length !== 1)
        throw new Error("MESSAGE_SYNC_DUPLICATE_DELIVERY_FAILED");
      await sendWebhook(
        `msg_outsider_${suffix}_${provider}`,
        "created",
        "Outsider",
        createdAt,
        { id: "999999999", login: `outsider-${suffix}` },
        `${inboundCommentId}9`,
      );
      await invoke("/operational/provider-event-inbox");
      if ((await messageRows(current.feedbackId)).length !== 1)
        throw new Error("MESSAGE_SYNC_OUTSIDER_DENIAL_FAILED");

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const revisedContent = `Revised ${provider} content ${suffix}`;
      let revised: Readonly<Record<string, unknown>>;
      if (provider === "github") {
        revised = await providerRequest(
          current,
          `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues/comments/${inboundCommentId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: revisedContent }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_COMMENT_EDIT_FAILED"));
      } else {
        const origin = new URL(
          process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
        );
        revised = await providerRequest(
          current,
          new URL(
            `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues/${issueId}/notes/${inboundCommentId}`,
            origin,
          ),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: revisedContent }),
          },
        ).then((response) => json(response, "MESSAGE_SYNC_COMMENT_EDIT_FAILED"));
      }
      const revisedAt = required(
        revised.updated_at,
        "MESSAGE_SYNC_COMMENT_EDIT_FAILED",
      );
      await sendWebhook(
        `msg_edit_${suffix}_${provider}`,
        "revised",
        revisedContent,
        revisedAt,
      );
      await invoke("/operational/provider-event-inbox");
      messages = await messageRows(current.feedbackId);
      const original = messages[0];
      const revision = messages[1];
      if (
        messages.length !== 2 ||
        !original ||
        !revision ||
        revision.revisionKind !== "revised" ||
        revision.supersedesMessageId !== original.$id
      )
        throw new Error("MESSAGE_SYNC_REVISION_FAILED");
      await sendWebhook(
        `msg_old_${suffix}_${provider}`,
        "revised",
        "Delayed old edit",
        createdAt,
      );
      await invoke("/operational/provider-event-inbox");
      if ((await messageRows(current.feedbackId)).length !== 2)
        throw new Error("MESSAGE_SYNC_REORDER_FAILED");

      if (provider === "github") {
        await providerRequest(
          current,
          `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues/comments/${inboundCommentId}`,
          { method: "DELETE" },
        );
      } else {
        const origin = new URL(
          process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
        );
        await providerRequest(
          current,
          new URL(
            `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues/${issueId}/notes/${inboundCommentId}`,
            origin,
          ),
          { method: "DELETE" },
        );
      }
      inboundCommentId = undefined;
      await invoke("/operational/provider-maintenance");
      messages = await messageRows(current.feedbackId);
      const priorRevision = messages[1];
      const tombstone = messages[2];
      if (
        messages.length !== 3 ||
        !priorRevision ||
        !tombstone ||
        tombstone.revisionKind !== "tombstoned" ||
        tombstone.supersedesMessageId !== priorRevision.$id
      )
        throw new Error("MESSAGE_SYNC_TOMBSTONE_FAILED");

      const fanout = createNodeAppwriteProviderMessageFanout(
        tables,
        {
          databaseId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
          providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
        },
        persistence,
      );
      const append = async (messageId: string, audience: "reporter" | "workspace") => {
        const tx = await tables.createTransaction({ ttl: 60 });
        try {
          const result = await fanout.append({
            transactionId: tx.$id,
            feedbackId: current.feedbackId,
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            messageId,
            actorKind: "reporter",
            audience,
            content: `Allow-listed outbound ${suffix}`,
            occurredAt: new Date().toISOString(),
          });
          await tables.updateTransaction({ transactionId: tx.$id, commit: true });
          return result;
        } catch (error) {
          await tables.updateTransaction({ transactionId: tx.$id, rollback: true });
          throw error;
        }
      };
      if ((await append(`note_${suffix}`, "workspace")).queued !== 0)
        throw new Error("MESSAGE_SYNC_INTERNAL_NOTE_EXPORTED");
      if (current.repository.visibility === "public") {
        if ((await append(`deny_${suffix}`, "reporter")).queued !== 0)
          throw new Error("MESSAGE_SYNC_PUBLIC_CONSENT_DENIAL_FAILED");
        await create(
          config.appwriteSchema.publicationConsentsTableId,
          `cns1_${suffix}`,
          {
            feedbackId: current.feedbackId,
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            reporterId: `rep_${suffix}`,
            operationId: `grant_${suffix}`,
            payloadDigest: "0".repeat(64),
            version: 1,
            state: "active",
            disclosureVersion: "public-issue-v1",
            audience: `${provider}:${current.repository.id}`,
            occurredAt: new Date().toISOString(),
          },
        );
      }
      const outboundMessageId = `${provider === "github" ? "ogh" : "ogl"}_${suffix}`;
      if ((await append(outboundMessageId, "reporter")).queued !== 1)
        throw new Error("MESSAGE_SYNC_OUTBOUND_QUEUE_FAILED");
      await invoke("/operational/provider-maintenance");
      let outbox = await outboxRows(current.feedbackId);
      const published = outbox.find((row) => row.operationId === outboundMessageId);
      if (
        !published ||
        published.status !== "succeeded" ||
        typeof published.providerObjectId !== "string"
      )
        throw new Error("MESSAGE_SYNC_OUTBOUND_DELIVERY_FAILED");
      const adapter =
        provider === "github"
          ? createGitHubMessageProvider(vault)
          : createGitLabMessageProvider(
              process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
              vault,
            );
      const inspected = await adapter.inspect({
        encryptedGrantRef: current.grantId,
        repository: current.repository,
        issueId,
        commentId: published.providerObjectId,
      });
      if (
        inspected.status !== "found" ||
        !inspected.content.includes(`Allow-listed outbound ${suffix}`)
      )
        throw new Error("MESSAGE_SYNC_OUTBOUND_CONTENT_FAILED");
      const serialized = JSON.stringify({ outbox, content: inspected.content });
      if (
        /proof|contact|attachment|internal.note|reporteridentifier/iu.test(serialized)
      )
        throw new Error("MESSAGE_SYNC_PROHIBITED_PAYLOAD_FAILED");

      if (current.repository.visibility === "public") {
        await create(
          config.appwriteSchema.publicationConsentsTableId,
          `cns2_${suffix}`,
          {
            feedbackId: current.feedbackId,
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            reporterId: `rep_${suffix}`,
            operationId: `revoke_${suffix}`,
            payloadDigest: "1".repeat(64),
            version: 2,
            state: "revoked",
            disclosureVersion: "public-issue-v1",
            audience: `${provider}:${current.repository.id}`,
            occurredAt: new Date().toISOString(),
          },
        );
        await createNodeAppwriteProviderConsentCleanup(
          tables,
          {
            databaseId,
            externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
            providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
          },
          persistence,
        ).request({
          feedbackId: current.feedbackId,
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          consentOperationId: `revoke_${suffix}`,
          occurredAt: new Date().toISOString(),
        });
        await invoke("/operational/provider-maintenance");
        outbox = await outboxRows(current.feedbackId);
        if (
          !outbox.some(
            (row) => row.kind === "remove_message" && row.status === "succeeded",
          )
        )
          throw new Error("MESSAGE_SYNC_CONSENT_CLEANUP_FAILED");
        if ((await append(`after_${suffix}`, "reporter")).queued !== 0)
          throw new Error("MESSAGE_SYNC_REVOKED_PUBLICATION_FAILED");
      }
      outcomes.push({
        provider,
        inboundCreate: true,
        duplicateIgnored: true,
        outsiderDenied: true,
        revisionAppended: true,
        delayedIgnored: true,
        tombstoneAppended: true,
        outboundDelivered: true,
        internalNoteExcluded: true,
        consentEnforced: current.repository.visibility === "public",
        prohibitedPayloadExcluded: true,
      });
    } finally {
      if (inboundCommentId && issueId) {
        try {
          if (provider === "github")
            await providerRequest(
              current,
              `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues/comments/${inboundCommentId}`,
              { method: "DELETE" },
            );
          else {
            const origin = new URL(
              process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
            );
            await providerRequest(
              current,
              new URL(
                `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues/${issueId}/notes/${inboundCommentId}`,
                origin,
              ),
              { method: "DELETE" },
            );
          }
        } catch {
          /* best-effort provider cleanup */
        }
      }
      if (issueId) {
        try {
          if (provider === "github")
            await providerRequest(
              current,
              `https://api.github.com/repos/${encodeURIComponent(current.repository.owner)}/${encodeURIComponent(current.repository.name)}/issues/${issueId}`,
              {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
              },
            );
          else {
            const origin = new URL(
              process.env.GITLAB_OAUTH_ORIGIN?.trim() || "https://gitlab.com/",
            );
            await providerRequest(
              current,
              new URL(
                `api/v4/projects/${encodeURIComponent(current.repository.id)}/issues/${issueId}`,
                origin,
              ),
              {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ state_event: "close" }),
              },
            );
          }
        } catch {
          /* best-effort provider cleanup */
        }
      }
      for (const tableId of [
        config.appwriteSchema.providerEventInboxTableId,
        config.appwriteSchema.providerSyncOutboxTableId,
        config.appwriteSchema.conversationMessagesTableId,
      ]) {
        try {
          const rows = await tables.listRows({
            databaseId,
            tableId,
            queries: [
              Query.equal(
                tableId === config.appwriteSchema.providerEventInboxTableId
                  ? "connectionId"
                  : "feedbackId",
                [
                  tableId === config.appwriteSchema.providerEventInboxTableId
                    ? current.connectionId
                    : current.feedbackId,
                ],
              ),
              Query.limit(100),
            ],
            total: false,
          });
          for (const row of rows.rows)
            await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
        } catch {
          /* continue cleanup */
        }
      }
      for (const [tableId, rowId] of [...created].reverse()) {
        try {
          await tables.deleteRow({ databaseId, tableId, rowId });
        } catch {
          /* continue cleanup */
        }
      }
      created.length = 0;
    }
  }
  process.stdout.write(
    `${JSON.stringify({ result: "PROVIDER_MESSAGE_SYNC_REAL_MATRIX_PASSED", providers: outcomes })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "MESSAGE_SYNC_VERIFY_FAILED";
  const diagnostic = object(error)
    ? {
        error: code,
        errorType:
          typeof error.type === "string" && /^[a-z0-9_.-]+$/u.test(error.type)
            ? error.type
            : undefined,
        statusCode: typeof error.code === "number" ? error.code : undefined,
      }
    : { error: code };
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = 1;
});
