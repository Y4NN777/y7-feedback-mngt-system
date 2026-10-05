import type { ExternalIssuePayload, SourceProvider } from "@y7-feedback/domain";

export type ProviderIssueFailure = "retryable" | "permanent";

export class ProviderIssueError extends Error {
  constructor(readonly failure: ProviderIssueFailure) {
    super(`PROVIDER_ISSUE_${failure.toUpperCase()}`);
    this.name = "ProviderIssueError";
  }
}

export interface ProviderIssueRepository {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
}

export interface ProviderIssueResult {
  readonly issueId: string;
  readonly issueUrl: string;
  readonly replayed: boolean;
}

export interface ProviderIssueAdapter {
  readonly provider: SourceProvider;
  createIssue(input: {
    readonly encryptedGrantRef: string;
    readonly operationId: string;
    readonly repository: ProviderIssueRepository;
    readonly payload: ExternalIssuePayload;
  }): Promise<ProviderIssueResult>;
}

const operationId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const safeText = /^[^\p{Cc}\p{Cf}]{1,200}$/u;

export function issueMarker(value: string): string {
  if (!operationId.test(value)) throw new ProviderIssueError("permanent");
  return `<!-- y7-feedback-operation:${value} -->`;
}

export function issueDocument(input: {
  readonly operationId: string;
  readonly repository: ProviderIssueRepository;
  readonly payload: ExternalIssuePayload;
}): { readonly title: string; readonly body: string; readonly marker: string } {
  const { repository, payload } = input;
  const origin: unknown = Reflect.get(payload, "origin");
  if (
    !identifier.test(repository.id) ||
    !safeText.test(repository.owner) ||
    !safeText.test(repository.name) ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u.test(payload.reference) ||
    !["bug", "suggestion", "review"].includes(payload.feedbackType) ||
    origin !== "y7-feedback"
  ) {
    throw new ProviderIssueError("permanent");
  }
  let link: URL;
  try {
    link = new URL(payload.protectedWorkspaceUrl);
    if (
      link.protocol !== "https:" ||
      link.username !== "" ||
      link.password !== "" ||
      link.hash !== ""
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new ProviderIssueError("permanent");
  }
  const marker = issueMarker(input.operationId);
  const body = [
    marker,
    `Y7 reference: ${payload.reference}`,
    `Protected feedback: ${link.toString()}`,
    ...(payload.reporterContent === undefined
      ? []
      : ["", "Reporter-approved content:", payload.reporterContent]),
    "",
    "Origin: y7-feedback",
  ].join("\n");
  return {
    title: `[Y7][${payload.feedbackType}] ${payload.reference}`,
    body,
    marker,
  };
}

export function classifyProviderStatus(status: number): ProviderIssueFailure {
  return status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
    ? "retryable"
    : "permanent";
}
