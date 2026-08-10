export type ReporterTrust = "unverified" | "verified";

export type ReporterAttribution =
  | { readonly kind: "unidentified" }
  | {
      readonly kind: "contact";
      readonly value: string;
      readonly purpose: string;
    }
  | {
      readonly kind: "external";
      readonly value: string;
      readonly issuer: string;
      readonly applicationId: string;
      readonly purpose: string;
    }
  | {
      readonly kind: "assertion";
      readonly value: string;
      readonly issuer: string;
      readonly applicationId: string;
      readonly purpose: string;
      readonly assertionVerified: boolean;
    };

export type ReporterIdentifier =
  | {
      readonly kind: "contact";
      readonly value: string;
      readonly purpose: string;
      readonly source: "public";
      readonly trust: "unverified";
    }
  | {
      readonly kind: "external";
      readonly value: string;
      readonly issuer: string;
      readonly applicationId: string;
      readonly purpose: string;
      readonly source: "public" | "client_assertion";
      readonly trust: ReporterTrust;
    };

export interface Reporter {
  readonly id: string;
  readonly workspaceId: string;
  readonly identifiers: readonly ReporterIdentifier[];
}

export interface ReporterAttributionResult {
  readonly decision: "created" | "matched";
  readonly reporter: Reporter;
}

export interface AttributionHistory {
  readonly workspaceId: string;
  readonly priorReporterId: string;
  readonly resultingReporterId: string | null;
  readonly operation: "link" | "correct" | "merge" | "anonymize";
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: string;
}

export class ReporterPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReporterPolicyError";
    this.code = code;
  }
}

export interface ReporterRegistry {
  attribute(
    workspaceId: string,
    attribution: ReporterAttribution,
  ): ReporterAttributionResult;
  changeAttribution(
    command: Omit<AttributionHistory, "occurredAt">,
  ): AttributionHistory;
  history(): readonly AttributionHistory[];
}

function required(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ReporterPolicyError("REPORTER_ATTRIBUTION_INVALID");
  }
  return normalized;
}

function assertionKey(
  workspaceId: string,
  issuer: string,
  applicationId: string,
  value: string,
): string {
  return JSON.stringify([workspaceId, issuer, applicationId, value]);
}

export function createReporterRegistry(dependencies: {
  readonly nextReporterId: () => string;
  readonly now: () => string;
}): ReporterRegistry {
  const reporters = new Map<string, Reporter>();
  const verifiedAssertions = new Map<string, string>();
  const attributionHistory: AttributionHistory[] = [];

  return {
    attribute(workspaceId, attribution) {
      const scope = required(workspaceId, 200);
      let identifiers: readonly ReporterIdentifier[] = [];
      let verifiedKey: string | undefined;

      if (attribution.kind === "contact") {
        identifiers = [
          {
            kind: "contact",
            value: required(attribution.value, 320),
            purpose: required(attribution.purpose, 300),
            source: "public",
            trust: "unverified",
          },
        ];
      } else if (attribution.kind === "external") {
        identifiers = [
          {
            kind: "external",
            value: required(attribution.value, 300),
            issuer: required(attribution.issuer, 200),
            applicationId: required(attribution.applicationId, 200),
            purpose: required(attribution.purpose, 300),
            source: "public",
            trust: "unverified",
          },
        ];
      } else if (attribution.kind === "assertion") {
        if (!attribution.assertionVerified) {
          throw new ReporterPolicyError("REPORTER_ASSERTION_UNVERIFIED");
        }
        const identifier: ReporterIdentifier = {
          kind: "external",
          value: required(attribution.value, 300),
          issuer: required(attribution.issuer, 200),
          applicationId: required(attribution.applicationId, 200),
          purpose: required(attribution.purpose, 300),
          source: "client_assertion",
          trust: "verified",
        };
        identifiers = [identifier];
        verifiedKey = assertionKey(
          scope,
          identifier.issuer,
          identifier.applicationId,
          identifier.value,
        );
        const existingId = verifiedAssertions.get(verifiedKey);
        const existing = existingId ? reporters.get(existingId) : undefined;
        if (existing) {
          return { decision: "matched", reporter: existing };
        }
      }

      const reporter: Reporter = {
        id: dependencies.nextReporterId(),
        workspaceId: scope,
        identifiers,
      };
      reporters.set(reporter.id, reporter);
      if (verifiedKey) {
        verifiedAssertions.set(verifiedKey, reporter.id);
      }
      return { decision: "created", reporter };
    },
    changeAttribution(command) {
      const prior = reporters.get(command.priorReporterId);
      const resulting = command.resultingReporterId
        ? reporters.get(command.resultingReporterId)
        : undefined;
      const isAnonymization = command.operation === "anonymize";
      if (
        !prior ||
        prior.workspaceId !== command.workspaceId ||
        (!isAnonymization && !resulting) ||
        (resulting && resulting.workspaceId !== command.workspaceId) ||
        (isAnonymization && command.resultingReporterId !== null)
      ) {
        throw new ReporterPolicyError("REPORTER_SCOPE_DENIED");
      }
      const event: AttributionHistory = {
        ...command,
        reason: required(command.reason, 500),
        actor: required(command.actor, 200),
        occurredAt: dependencies.now(),
      };
      attributionHistory.push(event);
      return event;
    },
    history() {
      return [...attributionHistory];
    },
  };
}
