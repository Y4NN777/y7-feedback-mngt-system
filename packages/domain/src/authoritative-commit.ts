export type AuthoritativeCommitEnvironment = "preview" | "production";
export type AuthoritativeAggregateKind = "feedback" | "conversation";
export type AuthoritativeActorKind = "reporter" | "user" | "system";

export interface AuthoritativeCommitInput {
  readonly environment: AuthoritativeCommitEnvironment;
  readonly aggregateKind: AuthoritativeAggregateKind;
  readonly aggregateId: string;
  readonly operationId: string;
  readonly commandKind: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorKind: AuthoritativeActorKind;
  readonly actorId: string;
  readonly payloadDigest: string;
  readonly sealedPayload: string;
  readonly acceptedAt: string;
}

export interface AuthoritativeCommit extends AuthoritativeCommitInput {
  readonly id: string;
  readonly version: 1;
  readonly projectionState: "pending";
  readonly projectionAttempts: 0;
}

export type AuthoritativeCommitIdDeriver = (identity: string) => string;

export class AuthoritativeCommitError extends Error {
  readonly code: "AUTHORITATIVE_COMMIT_CONFLICT" | "AUTHORITATIVE_COMMIT_INVALID";

  constructor(code: AuthoritativeCommitError["code"]) {
    super(code);
    this.name = "AuthoritativeCommitError";
    this.code = code;
  }
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const commandKind = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,7}$/u;
const digest = /^[A-Za-z0-9_-]{16,128}$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function validTimestamp(value: string): boolean {
  return timestamp.test(value) && Number.isFinite(Date.parse(value));
}

export function planAuthoritativeCommit(
  input: AuthoritativeCommitInput,
  deriveId: AuthoritativeCommitIdDeriver,
): AuthoritativeCommit {
  const environment: unknown = input.environment;
  const aggregateKind: unknown = input.aggregateKind;
  const actorKind: unknown = input.actorKind;
  if (
    (environment !== "preview" && environment !== "production") ||
    (aggregateKind !== "feedback" && aggregateKind !== "conversation") ||
    !identifier.test(input.aggregateId) ||
    !identifier.test(input.operationId) ||
    !commandKind.test(input.commandKind) ||
    !identifier.test(input.workspaceId) ||
    !identifier.test(input.projectId) ||
    (actorKind !== "reporter" && actorKind !== "user" && actorKind !== "system") ||
    !identifier.test(input.actorId) ||
    !digest.test(input.payloadDigest) ||
    input.sealedPayload.length === 0 ||
    input.sealedPayload.length > 500_000 ||
    !validTimestamp(input.acceptedAt)
  ) {
    throw new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID");
  }
  const identity = [
    input.environment,
    input.aggregateKind,
    input.aggregateId,
    input.operationId,
  ].join("\u0000");
  const id = deriveId(identity);
  if (!identifier.test(id)) {
    throw new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID");
  }
  return {
    id,
    version: 1,
    ...input,
    projectionState: "pending",
    projectionAttempts: 0,
  };
}

export function resolveAuthoritativeCommitReplay(
  commit: AuthoritativeCommit,
  payloadDigest: string,
): { readonly status: "replayed"; readonly commit: AuthoritativeCommit } {
  if (!digest.test(payloadDigest)) {
    throw new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_INVALID");
  }
  if (commit.payloadDigest !== payloadDigest) {
    throw new AuthoritativeCommitError("AUTHORITATIVE_COMMIT_CONFLICT");
  }
  return { status: "replayed", commit };
}
