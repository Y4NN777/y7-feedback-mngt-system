import { randomBytes } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

import { Client, TablesDB, Users } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

type Provider = "github" | "gitlab";

interface StateFile {
  readonly provider: Provider;
  readonly authorizationUrl: string;
  readonly jwt: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function provider(value: string | undefined): Provider {
  if (value !== "github" && value !== "gitlab") {
    throw new Error("SOURCE_VERIFY_PROVIDER_INVALID");
  }
  return value;
}

function temporaryPath(name: "state-file" | "response-file"): string {
  const value = argument(name);
  if (!value?.startsWith("/tmp/y7-source-") || !value.endsWith(".json")) {
    throw new Error("SOURCE_VERIFY_PATH_INVALID");
  }
  return value;
}

async function jsonResponse(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const value = (await response.json()) as unknown;
  if (!isObject(value)) throw new Error("SOURCE_VERIFY_RESPONSE_INVALID");
  return value;
}

async function prepare(path: string, sourceProvider: Provider): Promise<void> {
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview") {
    throw new Error("SOURCE_VERIFY_PREVIEW_REQUIRED");
  }
  const functionUrl = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (!functionUrl) throw new Error("SOURCE_VERIFY_DOMAIN_MISSING");
  const suffix = randomBytes(7).toString("hex");
  const userId = `src_owner_${suffix}`;
  const membershipId = `src_member_${suffix}`;
  const workspaceId = "workspace_alpha";
  const projectId = "project_alpha";
  const admin = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const users = new Users(admin);
  const tables = new TablesDB(admin);
  let userCreated = false;
  let membershipCreated = false;
  try {
    await users.create({ userId, name: "Source provider Preview verifier" });
    userCreated = true;
    const session = await users.createSession({ userId });
    const token = await users.createJWT({
      userId,
      sessionId: session.$id,
      duration: 900,
    });
    const now = new Date().toISOString();
    await tables.createRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.workspaceMembershipsTableId,
      rowId: membershipId,
      data: {
        workspaceId,
        userId,
        role: "workspace_owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      permissions: [],
    });
    membershipCreated = true;
    const response = await fetch(
      new URL(
        `/v1/workspaces/${workspaceId}/projects/${projectId}/source-connections/${sourceProvider}/begin`,
        functionUrl,
      ),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token.jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ returnPath: "/settings/sources" }),
      },
    );
    const body = await jsonResponse(response);
    if (
      response.status !== 200 ||
      body.status !== "ok" ||
      typeof body.authorizationUrl !== "string"
    ) {
      throw new Error("SOURCE_VERIFY_BEGIN_FAILED");
    }
    const authorization = new URL(body.authorizationUrl);
    const expectedHost = sourceProvider === "github" ? "github.com" : "gitlab.com";
    if (
      authorization.protocol !== "https:" ||
      authorization.hostname !== expectedHost
    ) {
      throw new Error("SOURCE_VERIFY_AUTHORIZATION_INVALID");
    }
    const state: StateFile = {
      provider: sourceProvider,
      authorizationUrl: authorization.toString(),
      jwt: token.jwt,
      userId,
      membershipId,
      workspaceId,
      projectId,
    };
    await writeFile(path, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
    process.stdout.write(
      `${JSON.stringify({ provider: sourceProvider, prepared: true, statePersisted: true })}\n`,
    );
  } catch (error) {
    if (membershipCreated) {
      await tables
        .deleteRow({
          databaseId: config.appwriteSchema.databaseId,
          tableId: config.appwriteSchema.workspaceMembershipsTableId,
          rowId: membershipId,
        })
        .catch(() => undefined);
    }
    if (userCreated) await users.delete({ userId }).catch(() => undefined);
    throw error;
  }
}

async function finalize(path: string, callbackPath: string): Promise<void> {
  const config = parseServerConfig(process.env);
  const functionUrl = process.env.Y7_FUNCTION_DOMAIN_URL?.trim();
  if (config.environment !== "preview" || !functionUrl) {
    throw new Error("SOURCE_VERIFY_PREVIEW_REQUIRED");
  }
  const rawState = JSON.parse(await readFile(path, "utf8")) as unknown;
  const callback = JSON.parse(await readFile(callbackPath, "utf8")) as unknown;
  if (!isObject(rawState) || !isObject(callback)) {
    throw new Error("SOURCE_VERIFY_STATE_INVALID");
  }
  const state = rawState as unknown as StateFile;
  const connectionId = callback.connectionId;
  const authorized = callback.authorizedRepositories;
  if (
    callback.status !== "pending_selection" ||
    typeof connectionId !== "string" ||
    !Array.isArray(authorized) ||
    authorized.length === 0 ||
    !isObject(authorized[0]) ||
    authorized[0].provider !== state.provider ||
    typeof authorized[0].id !== "string"
  ) {
    throw new Error("SOURCE_VERIFY_CALLBACK_INVALID");
  }
  const admin = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const users = new Users(admin);
  const tables = new TablesDB(admin);
  try {
    const base = `/v1/workspaces/${state.workspaceId}/projects/${state.projectId}/source-connections/${connectionId}`;
    const select = await fetch(new URL(`${base}/select`, functionUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${state.jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ repositoryIds: [authorized[0].id] }),
    });
    const selected = await jsonResponse(select);
    if (select.status !== 200 || selected.status !== "active") {
      throw new Error("SOURCE_VERIFY_SELECTION_FAILED");
    }
    const disconnect = await fetch(new URL(`${base}/disconnect`, functionUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${state.jwt}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const disconnected = await jsonResponse(disconnect);
    if (disconnect.status !== 200 || disconnected.status !== "disconnected") {
      throw new Error("SOURCE_VERIFY_REVOCATION_FAILED");
    }
    process.stdout.write(
      `${JSON.stringify({
        provider: state.provider,
        callback: true,
        authorizedRepositoryCount: authorized.length,
        selected: true,
        revoked: true,
        cleanup: true,
      })}\n`,
    );
  } finally {
    await tables
      .deleteRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.sourceConnectionsTableId,
        rowId: connectionId,
      })
      .catch(() => undefined);
    await tables
      .deleteRow({
        databaseId: config.appwriteSchema.databaseId,
        tableId: config.appwriteSchema.workspaceMembershipsTableId,
        rowId: state.membershipId,
      })
      .catch(() => undefined);
    await users.delete({ userId: state.userId }).catch(() => undefined);
    await unlink(path).catch(() => undefined);
    await unlink(callbackPath).catch(() => undefined);
  }
}

async function cleanup(path: string): Promise<void> {
  const config = parseServerConfig(process.env);
  if (config.environment !== "preview") {
    throw new Error("SOURCE_VERIFY_PREVIEW_REQUIRED");
  }
  const rawState = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isObject(rawState)) throw new Error("SOURCE_VERIFY_STATE_INVALID");
  const state = rawState as unknown as StateFile;
  const opaqueState = new URL(state.authorizationUrl).searchParams.get("state");
  const connectionId = opaqueState?.split(".", 1)[0];
  if (
    state.provider !== "github" ||
    state.workspaceId !== "workspace_alpha" ||
    state.projectId !== "project_alpha" ||
    !/^src_owner_[a-f0-9]{14}$/.test(state.userId) ||
    !/^src_member_[a-f0-9]{14}$/.test(state.membershipId) ||
    !connectionId ||
    !/^[a-f0-9]{20}$/.test(connectionId)
  ) {
    throw new Error("SOURCE_VERIFY_STATE_INVALID");
  }
  const admin = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const users = new Users(admin);
  const tables = new TablesDB(admin);
  const [sourceConnection, membership, user] = await Promise.all([
    tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      rowId: connectionId,
    }),
    tables.getRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.workspaceMembershipsTableId,
      rowId: state.membershipId,
    }),
    users.get({ userId: state.userId }),
  ]);
  if (
    sourceConnection.workspaceId !== state.workspaceId ||
    sourceConnection.projectId !== state.projectId ||
    sourceConnection.provider !== state.provider ||
    !["pending", "claiming"].includes(String(sourceConnection.status)) ||
    membership.workspaceId !== state.workspaceId ||
    membership.userId !== state.userId ||
    user.$id !== state.userId
  ) {
    throw new Error("SOURCE_VERIFY_CLEANUP_SCOPE_INVALID");
  }
  const sourceConnectionDeleted = await tables
    .deleteRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.sourceConnectionsTableId,
      rowId: connectionId,
    })
    .then(() => true)
    .catch(() => false);
  const membershipDeleted = await tables
    .deleteRow({
      databaseId: config.appwriteSchema.databaseId,
      tableId: config.appwriteSchema.workspaceMembershipsTableId,
      rowId: state.membershipId,
    })
    .then(() => true)
    .catch(() => false);
  const userDeleted = await users
    .delete({ userId: state.userId })
    .then(() => true)
    .catch(() => false);
  await unlink(path).catch(() => undefined);
  process.stdout.write(
    `${JSON.stringify({
      provider: state.provider,
      sourceConnectionDeleted,
      membershipDeleted,
      userDeleted,
      stateFileDeleted: true,
    })}\n`,
  );
}

async function serve(path: string): Promise<void> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isObject(raw) || typeof raw.authorizationUrl !== "string") {
    throw new Error("SOURCE_VERIFY_STATE_INVALID");
  }
  const port = Number(argument("port"));
  if (!Number.isSafeInteger(port) || port < 40_000 || port > 49_999) {
    throw new Error("SOURCE_VERIFY_PORT_INVALID");
  }
  await new Promise<void>((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.url !== "/authorize") {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(302, {
        "cache-control": "no-store",
        location: raw.authorizationUrl as string,
      });
      response.end();
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      process.stdout.write(
        `${JSON.stringify({ ready: true, localPort: port, oneUse: true })}\n`,
      );
    });
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--prepare")) {
    await prepare(temporaryPath("state-file"), provider(argument("provider")));
    return;
  }
  if (process.argv.includes("--finalize")) {
    await finalize(temporaryPath("state-file"), temporaryPath("response-file"));
    return;
  }
  if (process.argv.includes("--cleanup")) {
    await cleanup(temporaryPath("state-file"));
    return;
  }
  if (process.argv.includes("--serve")) {
    await serve(temporaryPath("state-file"));
    return;
  }
  throw new Error("SOURCE_VERIFY_MODE_REQUIRED");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      code: error instanceof Error ? error.message : "SOURCE_VERIFY_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
