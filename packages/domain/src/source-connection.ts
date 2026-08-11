import type { ActorAccess } from "./authorization";
import type { Project } from "./policy";

export type SourceProvider = "github" | "gitlab";
export type SourceConnectionState = "active" | "suspended" | "disconnected";

export interface RepositoryIdentity {
  readonly provider: SourceProvider;
  readonly id: string;
}

export interface SourceConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly state: SourceConnectionState;
  readonly selectedRepositories: readonly RepositoryIdentity[];
}

interface StoredConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly encryptedGrantRef: string;
  state: SourceConnectionState;
  readonly selectedRepositories: readonly RepositoryIdentity[];
  grantRevoked: boolean;
}

interface CallbackChallenge {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly nonceDigest: string;
  readonly expiresAt: number;
}

export class SourcePolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SourcePolicyError";
    this.code = code;
  }
}

export interface SourceConnectionDependencies {
  readonly digestNonce: (nonce: string) => string;
  readonly nextId: () => string;
  readonly now: () => number;
  readonly revokeGrant: (encryptedGrantRef: string) => void;
}

interface BeginConnection {
  readonly actor: ActorAccess;
  readonly project: Project;
  readonly provider: SourceProvider;
  readonly nonce: string;
  readonly returnPath: string;
  readonly ttlMs: number;
}

interface CompleteConnection {
  readonly actor: ActorAccess;
  readonly project: Project;
  readonly provider: SourceProvider;
  readonly nonce: string;
  readonly stateId: string;
  readonly encryptedGrantRef: string;
  readonly authorizedRepositories: readonly RepositoryIdentity[];
  readonly selectedRepositoryIds: readonly string[];
}

export interface SourceConnectionRegistry {
  begin(command: BeginConnection): {
    readonly stateId: string;
    readonly expiresAt: number;
  };
  complete(command: CompleteConnection): SourceConnection;
  suspend(actor: ActorAccess, project: Project, connectionId: string): void;
  reconnect(actor: ActorAccess, project: Project, connectionId: string): void;
  disconnect(actor: ActorAccess, project: Project, connectionId: string): void;
  canUse(connectionId: string, repository: RepositoryIdentity): boolean;
}

function authorizeOwner(actor: ActorAccess, project: Project): void {
  if (
    actor.responsibility !== "workspace_owner" ||
    !actor.workspaceIds.includes(project.workspaceId)
  ) {
    throw new SourcePolicyError("SOURCE_SCOPE_DENIED");
  }
}

function projectConnection(
  connections: ReadonlyMap<string, StoredConnection>,
  actor: ActorAccess,
  project: Project,
  connectionId: string,
): StoredConnection {
  authorizeOwner(actor, project);
  const connection = connections.get(connectionId);
  if (
    !connection ||
    connection.workspaceId !== project.workspaceId ||
    connection.projectId !== project.id
  ) {
    throw new SourcePolicyError("SOURCE_SCOPE_DENIED");
  }
  return connection;
}

function projectView(connection: StoredConnection): SourceConnection {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    projectId: connection.projectId,
    provider: connection.provider,
    state: connection.state,
    selectedRepositories: connection.selectedRepositories,
  };
}

export function createSourceConnectionRegistry(
  dependencies: SourceConnectionDependencies,
): SourceConnectionRegistry {
  const challenges = new Map<string, CallbackChallenge>();
  const connections = new Map<string, StoredConnection>();

  return {
    begin(command) {
      authorizeOwner(command.actor, command.project);
      if (
        !command.returnPath.startsWith("/") ||
        command.returnPath.startsWith("//") ||
        command.returnPath.includes("\\") ||
        command.ttlMs <= 0
      ) {
        throw new SourcePolicyError("RETURN_PATH_INVALID");
      }
      const stateId = dependencies.nextId();
      const expiresAt = dependencies.now() + command.ttlMs;
      challenges.set(stateId, {
        actorId: command.actor.principalId,
        workspaceId: command.project.workspaceId,
        projectId: command.project.id,
        provider: command.provider,
        nonceDigest: dependencies.digestNonce(command.nonce),
        expiresAt,
      });
      return { stateId, expiresAt };
    },
    complete(command) {
      const challenge = challenges.get(command.stateId);
      challenges.delete(command.stateId);
      authorizeOwner(command.actor, command.project);
      if (
        !challenge ||
        dependencies.now() > challenge.expiresAt ||
        challenge.actorId !== command.actor.principalId ||
        challenge.workspaceId !== command.project.workspaceId ||
        challenge.projectId !== command.project.id ||
        challenge.provider !== command.provider ||
        challenge.nonceDigest !== dependencies.digestNonce(command.nonce) ||
        !command.encryptedGrantRef
      ) {
        throw new SourcePolicyError("CALLBACK_INVALID");
      }

      const authorized = new Map(
        command.authorizedRepositories
          .filter((repository) => repository.provider === command.provider)
          .map((repository) => [repository.id, repository] as const),
      );
      const selectedIds = new Set(command.selectedRepositoryIds);
      const selectedRepositories = [...selectedIds].map((id) => authorized.get(id));
      if (
        selectedIds.size !== command.selectedRepositoryIds.length ||
        selectedRepositories.some((repository) => repository === undefined)
      ) {
        throw new SourcePolicyError("REPOSITORY_NOT_AUTHORIZED");
      }

      const id = `connection:${command.stateId}`;
      const connection: StoredConnection = {
        id,
        workspaceId: command.project.workspaceId,
        projectId: command.project.id,
        provider: command.provider,
        encryptedGrantRef: command.encryptedGrantRef,
        state: "active",
        selectedRepositories: selectedRepositories as readonly RepositoryIdentity[],
        grantRevoked: false,
      };
      connections.set(id, connection);
      return projectView(connection);
    },
    suspend(actor, project, connectionId) {
      const connection = projectConnection(connections, actor, project, connectionId);
      if (connection.state === "disconnected") {
        throw new SourcePolicyError("CONNECTION_STATE_INVALID");
      }
      connection.state = "suspended";
    },
    reconnect(actor, project, connectionId) {
      const connection = projectConnection(connections, actor, project, connectionId);
      if (connection.state !== "suspended") {
        throw new SourcePolicyError("CONNECTION_STATE_INVALID");
      }
      connection.state = "active";
    },
    disconnect(actor, project, connectionId) {
      const connection = projectConnection(connections, actor, project, connectionId);
      connection.state = "disconnected";
      if (!connection.grantRevoked) {
        dependencies.revokeGrant(connection.encryptedGrantRef);
        connection.grantRevoked = true;
      }
    },
    canUse(connectionId, repository) {
      const connection = connections.get(connectionId);
      return Boolean(
        connection &&
        connection.state === "active" &&
        connection.provider === repository.provider &&
        connection.selectedRepositories.some(
          (selected) => selected.id === repository.id,
        ),
      );
    },
  };
}
