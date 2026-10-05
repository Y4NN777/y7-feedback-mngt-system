import type { ProjectAdministrationCommand } from "@y7-feedback/domain";

type CreateProjectCommand = Extract<
  ProjectAdministrationCommand,
  { kind: "create_project" }
>;
type MutationCommand = Exclude<
  ProjectAdministrationCommand,
  { kind: "create_project" }
>;

export class ProjectAdministrationPersistenceError extends Error {
  readonly code:
    | "ERR-ADMIN-IDEMPOTENCY-CONFLICT"
    | "ERR-ADMIN-DENIED"
    | "ERR-ADMIN-MUTATION-INVALID"
    | "ERR-ADMIN-SLUG-RESERVED"
    | "ERR-ADMIN-RETRYABLE";

  constructor(code: ProjectAdministrationPersistenceError["code"]) {
    super(code);
    this.name = "AppwriteProjectAdministrationError";
    this.code = code;
  }
}

export type WorkspaceOwnerScopeOutcome =
  | {
      readonly status: "authorized";
      readonly principalId: string;
      readonly workspaceId: string;
    }
  | { readonly status: "denied" | "retryable" };

export interface WorkspaceOwnerScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
  }): Promise<WorkspaceOwnerScopeOutcome>;
}

export interface CreateProjectAdministrationInput {
  readonly command: CreateProjectCommand;
  readonly actorId: string;
  readonly auditId: string;
  readonly occurredAt: string;
  readonly payloadDigest: string;
}

export interface MutateProjectAdministrationInput {
  readonly command: MutationCommand;
  readonly actorId: string;
  readonly auditId: string;
  readonly occurredAt: string;
  readonly payloadDigest: string;
}

export type CreateProjectAdministrationResult = {
  readonly status: "created" | "replayed";
  readonly projectId: string;
  readonly slug: string;
};

export type MutateProjectAdministrationResult = {
  readonly status: "applied" | "replayed";
  readonly projectId: string;
  readonly action: MutationCommand["kind"];
  readonly slug?: string;
  readonly active?: boolean;
  readonly maintainerId?: string;
};

export interface ProjectAdministrationStore {
  create(
    input: CreateProjectAdministrationInput,
  ): Promise<CreateProjectAdministrationResult>;
  mutate(
    input: MutateProjectAdministrationInput,
  ): Promise<MutateProjectAdministrationResult>;
}

export { ProjectAdministrationPersistenceError as AppwriteProjectAdministrationError };
