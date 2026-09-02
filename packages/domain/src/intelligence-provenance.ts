export type IntelligenceRelationType = "duplicate" | "depends_on" | "related";

export type IntelligenceAssociationTarget =
  | { readonly kind: "theme"; readonly label: string }
  | {
      readonly kind: "relationship";
      readonly relatedFeedbackId: string;
      readonly relationType: IntelligenceRelationType;
    };

interface ProvenanceBase {
  readonly eventId: string;
  readonly operationId: string;
  readonly associationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly feedbackId: string;
  readonly sourceVersion: number;
  readonly revision: number;
  readonly actorId: string;
  readonly occurredAt: string;
}

export type IntelligenceProvenanceEvent =
  | (ProvenanceBase & {
      readonly type: "association_recorded";
      readonly target: IntelligenceAssociationTarget;
    })
  | (ProvenanceBase & {
      readonly type: "association_corrected";
      readonly target: IntelligenceAssociationTarget;
      readonly priorEventId: string;
    })
  | (ProvenanceBase & {
      readonly type: "association_removed";
      readonly priorEventId: string;
    });

export interface IntelligenceAssociationProjection {
  readonly associationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly feedbackId: string;
  readonly sourceVersion: number;
  readonly revision: number;
  readonly target: IntelligenceAssociationTarget;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
  readonly removedAt?: string;
  readonly provenance: readonly IntelligenceProvenanceEvent[];
}

export type IntelligenceProvenanceCommand =
  | {
      readonly type: "record_association";
      readonly operationId: string;
      readonly workspaceId: string;
      readonly projectId: string;
      readonly feedbackId: string;
      readonly sourceVersion: number;
      readonly target: IntelligenceAssociationTarget;
    }
  | {
      readonly type: "correct_association";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
      readonly target: IntelligenceAssociationTarget;
    }
  | {
      readonly type: "remove_association";
      readonly operationId: string;
      readonly associationId: string;
      readonly expectedRevision: number;
    };

export interface IntelligenceProvenanceDependencies {
  readonly createEventId: () => string;
  readonly createAssociationId: () => string;
  readonly actorId: string;
  readonly now: () => string;
}

export type IntelligenceProvenanceDecision =
  | {
      readonly status: "accepted" | "replayed";
      readonly event: IntelligenceProvenanceEvent;
    }
  | { readonly status: "invalid" | "conflict" };

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function instant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /(?:Z|[+-]00:00)$/u.test(value);
}

function targetValid(
  target: IntelligenceAssociationTarget,
  feedbackId: string,
): boolean {
  return target.kind === "theme"
    ? target.label.trim() === target.label &&
        target.label.length >= 1 &&
        target.label.length <= 120
    : id.test(target.relatedFeedbackId) && target.relatedFeedbackId !== feedbackId;
}

function eventValid(event: IntelligenceProvenanceEvent): boolean {
  return (
    id.test(event.eventId) &&
    id.test(event.operationId) &&
    id.test(event.associationId) &&
    id.test(event.workspaceId) &&
    id.test(event.projectId) &&
    id.test(event.feedbackId) &&
    id.test(event.actorId) &&
    Number.isSafeInteger(event.sourceVersion) &&
    event.sourceVersion >= 1 &&
    Number.isSafeInteger(event.revision) &&
    event.revision >= 1 &&
    instant(event.occurredAt) &&
    (event.type === "association_removed" ||
      targetValid(event.target, event.feedbackId)) &&
    (event.type === "association_recorded" || id.test(event.priorEventId))
  );
}

export function projectIntelligenceAssociations(
  events: readonly IntelligenceProvenanceEvent[],
): readonly IntelligenceAssociationProjection[] {
  const projections = new Map<string, IntelligenceAssociationProjection>();
  const operations = new Set<string>();
  for (const event of events) {
    if (!eventValid(event) || operations.has(event.operationId))
      throw new Error("INTELLIGENCE_PROVENANCE_INVALID");
    operations.add(event.operationId);
    const current = projections.get(event.associationId);
    if (event.type === "association_recorded") {
      if (current || event.revision !== 1)
        throw new Error("INTELLIGENCE_PROVENANCE_INVALID");
      projections.set(event.associationId, {
        associationId: event.associationId,
        workspaceId: event.workspaceId,
        projectId: event.projectId,
        feedbackId: event.feedbackId,
        sourceVersion: event.sourceVersion,
        revision: 1,
        target: event.target,
        createdBy: event.actorId,
        createdAt: event.occurredAt,
        updatedBy: event.actorId,
        updatedAt: event.occurredAt,
        provenance: [event],
      });
      continue;
    }
    if (
      !current ||
      current.removedAt !== undefined ||
      event.workspaceId !== current.workspaceId ||
      event.projectId !== current.projectId ||
      event.feedbackId !== current.feedbackId ||
      event.sourceVersion !== current.sourceVersion ||
      event.revision !== current.revision + 1 ||
      event.priorEventId !== current.provenance.at(-1)?.eventId
    )
      throw new Error("INTELLIGENCE_PROVENANCE_INVALID");
    projections.set(event.associationId, {
      ...current,
      revision: event.revision,
      ...(event.type === "association_corrected" ? { target: event.target } : {}),
      updatedBy: event.actorId,
      updatedAt: event.occurredAt,
      ...(event.type === "association_removed" ? { removedAt: event.occurredAt } : {}),
      provenance: [...current.provenance, event],
    });
  }
  return [...projections.values()].sort((left, right) =>
    left.associationId.localeCompare(right.associationId),
  );
}

function replayMatches(
  event: IntelligenceProvenanceEvent,
  command: IntelligenceProvenanceCommand,
): boolean {
  if (event.type === "association_recorded" && command.type === "record_association")
    return (
      event.workspaceId === command.workspaceId &&
      event.projectId === command.projectId &&
      event.feedbackId === command.feedbackId &&
      event.sourceVersion === command.sourceVersion &&
      JSON.stringify(event.target) === JSON.stringify(command.target)
    );
  if (event.type === "association_corrected" && command.type === "correct_association")
    return (
      event.associationId === command.associationId &&
      event.revision === command.expectedRevision + 1 &&
      JSON.stringify(event.target) === JSON.stringify(command.target)
    );
  return (
    event.type === "association_removed" &&
    command.type === "remove_association" &&
    event.associationId === command.associationId &&
    event.revision === command.expectedRevision + 1
  );
}

export function decideIntelligenceProvenance(
  events: readonly IntelligenceProvenanceEvent[],
  command: IntelligenceProvenanceCommand,
  dependencies: IntelligenceProvenanceDependencies,
): IntelligenceProvenanceDecision {
  if (!id.test(command.operationId) || !id.test(dependencies.actorId))
    return { status: "invalid" };
  const replay = events.find(({ operationId }) => operationId === command.operationId);
  if (replay)
    return replayMatches(replay, command)
      ? { status: "replayed", event: replay }
      : { status: "conflict" };
  let projections: readonly IntelligenceAssociationProjection[];
  try {
    projections = projectIntelligenceAssociations(events);
  } catch {
    return { status: "conflict" };
  }
  const occurredAt = dependencies.now();
  const eventId = dependencies.createEventId();
  if (!id.test(eventId) || !instant(occurredAt)) return { status: "invalid" };
  if (command.type === "record_association") {
    const associationId = dependencies.createAssociationId();
    if (
      !id.test(associationId) ||
      !id.test(command.workspaceId) ||
      !id.test(command.projectId) ||
      !id.test(command.feedbackId) ||
      !Number.isSafeInteger(command.sourceVersion) ||
      command.sourceVersion < 1 ||
      !targetValid(command.target, command.feedbackId) ||
      projections.some(({ associationId: existing }) => existing === associationId)
    )
      return { status: "invalid" };
    return {
      status: "accepted",
      event: {
        type: "association_recorded",
        eventId,
        operationId: command.operationId,
        associationId,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        feedbackId: command.feedbackId,
        sourceVersion: command.sourceVersion,
        revision: 1,
        target: command.target,
        actorId: dependencies.actorId,
        occurredAt,
      },
    };
  }
  const current = projections.find(
    ({ associationId }) => associationId === command.associationId,
  );
  if (
    !current ||
    current.removedAt !== undefined ||
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision !== current.revision ||
    (command.type === "correct_association" &&
      !targetValid(command.target, current.feedbackId))
  )
    return { status: "conflict" };
  const priorEvent = current.provenance.at(-1) as IntelligenceProvenanceEvent;
  const common = {
    eventId,
    operationId: command.operationId,
    associationId: current.associationId,
    workspaceId: current.workspaceId,
    projectId: current.projectId,
    feedbackId: current.feedbackId,
    sourceVersion: current.sourceVersion,
    revision: current.revision + 1,
    actorId: dependencies.actorId,
    occurredAt,
    priorEventId: priorEvent.eventId,
  } as const;
  return command.type === "correct_association"
    ? {
        status: "accepted",
        event: { type: "association_corrected", ...common, target: command.target },
      }
    : {
        status: "accepted",
        event: { type: "association_removed", ...common },
      };
}
