import type { ActorAccess } from "./authorization.js";
import type { FeedbackType } from "./feedback.js";
import type { SourceConnectionState, SourceProvider } from "./source-connection.js";

export class ExternalIssuePolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ExternalIssuePolicyError";
    this.code = code;
  }
}

export interface PublicationConsentGrant {
  readonly feedbackId: string;
  readonly reporterId: string;
  readonly disclosureVersion: string;
  readonly audience: string;
  readonly occurredAt: string;
}

export interface PublicationConsentRevocation {
  readonly feedbackId: string;
  readonly reporterId: string;
  readonly occurredAt: string;
}

export interface PublicationConsentFact extends PublicationConsentGrant {
  readonly version: number;
  readonly state: "active" | "revoked";
}

export interface PublicationConsentLedger {
  grant(command: PublicationConsentGrant): PublicationConsentFact;
  revoke(command: PublicationConsentRevocation): PublicationConsentFact;
  active(feedbackId: string, version: number, audience?: string): boolean;
}

function requireUtcTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new ExternalIssuePolicyError("CONSENT_INVALID");
  }
}

export function createPublicationConsentLedger(): PublicationConsentLedger {
  const history = new Map<string, PublicationConsentFact[]>();

  return {
    grant(command) {
      requireUtcTimestamp(command.occurredAt);
      if (
        !command.feedbackId ||
        !command.reporterId ||
        !command.disclosureVersion ||
        !command.audience
      ) {
        throw new ExternalIssuePolicyError("CONSENT_INVALID");
      }
      const facts = history.get(command.feedbackId) ?? [];
      const current = facts.at(-1);
      if (
        current &&
        (current.reporterId !== command.reporterId ||
          current.audience !== command.audience ||
          current.disclosureVersion !== command.disclosureVersion)
      ) {
        throw new ExternalIssuePolicyError("CONSENT_SCOPE_DENIED");
      }
      const fact: PublicationConsentFact = {
        ...command,
        version: facts.length + 1,
        state: "active",
      };
      facts.push(fact);
      history.set(command.feedbackId, facts);
      return fact;
    },
    revoke(command) {
      requireUtcTimestamp(command.occurredAt);
      const facts = history.get(command.feedbackId) ?? [];
      const current = facts.at(-1);
      if (!current || current.reporterId !== command.reporterId) {
        throw new ExternalIssuePolicyError("CONSENT_SCOPE_DENIED");
      }
      const fact: PublicationConsentFact = {
        feedbackId: current.feedbackId,
        reporterId: current.reporterId,
        disclosureVersion: current.disclosureVersion,
        audience: current.audience,
        occurredAt: command.occurredAt,
        version: facts.length + 1,
        state: "revoked",
      };
      facts.push(fact);
      return fact;
    },
    active(feedbackId, version, audience) {
      const facts = history.get(feedbackId) ?? [];
      const current = facts.at(-1);
      return Boolean(
        current &&
        current.version === version &&
        current.state === "active" &&
        (audience === undefined || current.audience === audience),
      );
    },
  };
}

export interface SelectedIssueRepository {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: SourceProvider;
  readonly repositoryId: string;
  readonly visibility: "public" | "private";
  readonly connectionState: SourceConnectionState;
  readonly selected: boolean;
}

export interface ExternalIssueLinkCommand {
  readonly operationId: string;
  readonly actor: ActorAccess;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly feedbackId: string;
  readonly assignedPrincipalIds: readonly string[];
  readonly repository: SelectedIssueRepository;
  readonly reference: string;
  readonly protectedWorkspaceUrl: string;
  readonly feedbackType: FeedbackType;
  readonly reporterContent: string;
  readonly consentVersion: number | undefined;
}

export interface ExternalIssuePayload {
  readonly reference: string;
  readonly protectedWorkspaceUrl: string;
  readonly feedbackType: FeedbackType;
  readonly origin: "y7-feedback";
  readonly reporterContent?: string;
}

export interface ExternalIssueLink {
  readonly id: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly provider: SourceProvider;
  readonly repositoryId: string;
  readonly visibility: "public" | "private";
  readonly actorId: string;
  readonly state: "active";
  readonly synchronizationState: "pending";
}

export interface ProviderIssueOutboxItem {
  readonly id: string;
  readonly operationId: string;
  readonly feedbackId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly provider: SourceProvider;
  readonly repositoryId: string;
  readonly payload: ExternalIssuePayload;
  readonly state: "pending";
  readonly attempts: 0;
}

export interface ExternalIssueLinkResult {
  readonly link: ExternalIssueLink;
  readonly outbox: ProviderIssueOutboxItem;
}

export interface ExternalIssueLinkRegistry {
  request(command: ExternalIssueLinkCommand): ExternalIssueLinkResult;
}

function authorize(command: ExternalIssueLinkCommand): void {
  const workspaceAccess = command.actor.workspaceIds.includes(command.workspaceId);
  const owner = command.actor.responsibility === "workspace_owner";
  const assignedMaintainer =
    command.actor.responsibility === "project_maintainer" &&
    command.actor.projectIds.includes(command.projectId) &&
    command.assignedPrincipalIds.includes(command.actor.principalId);
  if (!workspaceAccess || (!owner && !assignedMaintainer)) {
    throw new ExternalIssuePolicyError("ISSUE_SCOPE_DENIED");
  }
}

function validateRepository(command: ExternalIssueLinkCommand): void {
  if (
    command.repository.workspaceId !== command.workspaceId ||
    command.repository.projectId !== command.projectId
  ) {
    throw new ExternalIssuePolicyError("REPOSITORY_SCOPE_DENIED");
  }
  if (!command.repository.selected) {
    throw new ExternalIssuePolicyError("REPOSITORY_NOT_SELECTED");
  }
  if (command.repository.connectionState !== "active") {
    throw new ExternalIssuePolicyError("SOURCE_CONNECTION_INACTIVE");
  }
}

function fingerprint(command: ExternalIssueLinkCommand): string {
  return JSON.stringify({
    actorId: command.actor.principalId,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    feedbackId: command.feedbackId,
    assignedPrincipalIds: [...command.assignedPrincipalIds].sort(),
    repository: command.repository,
    reference: command.reference,
    protectedWorkspaceUrl: command.protectedWorkspaceUrl,
    feedbackType: command.feedbackType,
    reporterContent: command.reporterContent,
    consentVersion: command.consentVersion,
  });
}

function validatePayloadInputs(command: ExternalIssueLinkCommand): void {
  let url: URL;
  try {
    url = new URL(command.protectedWorkspaceUrl);
  } catch {
    throw new ExternalIssuePolicyError("ISSUE_INPUT_INVALID");
  }
  if (
    !command.operationId ||
    !command.feedbackId ||
    !command.reference ||
    !command.reporterContent ||
    url.protocol !== "https:"
  ) {
    throw new ExternalIssuePolicyError("ISSUE_INPUT_INVALID");
  }
}

export function createExternalIssueLinkRegistry(
  consentLedger: PublicationConsentLedger,
): ExternalIssueLinkRegistry {
  const activeByFeedback = new Map<string, ExternalIssueLinkResult>();
  const operations = new Map<
    string,
    { readonly fingerprint: string; readonly result: ExternalIssueLinkResult }
  >();

  return {
    request(command) {
      validatePayloadInputs(command);
      authorize(command);
      validateRepository(command);
      const commandFingerprint = fingerprint(command);
      const replay = operations.get(command.operationId);
      if (replay) {
        if (replay.fingerprint !== commandFingerprint) {
          throw new ExternalIssuePolicyError("IDEMPOTENCY_CONFLICT");
        }
        return replay.result;
      }
      if (activeByFeedback.has(command.feedbackId)) {
        throw new ExternalIssuePolicyError("ACTIVE_LINK_EXISTS");
      }

      const audience = `${command.repository.provider}:${command.repository.repositoryId}`;
      const canPublishReporterContent =
        command.repository.visibility === "private" ||
        (command.consentVersion !== undefined &&
          consentLedger.active(command.feedbackId, command.consentVersion, audience));
      const payload: ExternalIssuePayload = {
        reference: command.reference,
        protectedWorkspaceUrl: command.protectedWorkspaceUrl,
        feedbackType: command.feedbackType,
        origin: "y7-feedback",
        ...(canPublishReporterContent
          ? { reporterContent: command.reporterContent }
          : {}),
      };
      const link: ExternalIssueLink = {
        id: `issue-link:${command.operationId}`,
        feedbackId: command.feedbackId,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        connectionId: command.repository.connectionId,
        provider: command.repository.provider,
        repositoryId: command.repository.repositoryId,
        visibility: command.repository.visibility,
        actorId: command.actor.principalId,
        state: "active",
        synchronizationState: "pending",
      };
      const result: ExternalIssueLinkResult = {
        link,
        outbox: {
          id: `provider-outbox:${command.operationId}`,
          operationId: command.operationId,
          feedbackId: command.feedbackId,
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          connectionId: command.repository.connectionId,
          provider: command.repository.provider,
          repositoryId: command.repository.repositoryId,
          payload,
          state: "pending",
          attempts: 0,
        },
      };
      activeByFeedback.set(command.feedbackId, result);
      operations.set(command.operationId, { fingerprint: commandFingerprint, result });
      return result;
    },
  };
}
