import type { SourceProvider } from "@y7-feedback/domain";

import type { ProviderGrantVault } from "./source-provider.js";

export class ProviderMessageError extends Error {
  constructor(readonly failure: "retryable" | "permanent") {
    super(`PROVIDER_MESSAGE_${failure.toUpperCase()}`);
    this.name = "ProviderMessageError";
  }
}

export interface ProviderMessageRepository {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
}

export interface ProviderMessageAdapter {
  readonly provider: SourceProvider;
  inspect(input: {
    readonly encryptedGrantRef: string;
    readonly repository: ProviderMessageRepository;
    readonly issueId: string;
    readonly commentId: string;
  }): Promise<
    | {
        readonly status: "found";
        readonly content: string;
        readonly authorId: string;
        readonly authorLogin: string;
        readonly updatedAt: string;
      }
    | { readonly status: "missing" }
  >;
  publish(input: {
    readonly encryptedGrantRef: string;
    readonly operationId: string;
    readonly repository: ProviderMessageRepository;
    readonly issueId: string;
    readonly content: string;
  }): Promise<{ readonly commentId: string; readonly replayed: boolean }>;
  remove(input: {
    readonly encryptedGrantRef: string;
    readonly operationId: string;
    readonly repository: ProviderMessageRepository;
    readonly issueId: string;
    readonly commentId: string;
  }): Promise<{ readonly missing: boolean }>;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const operation = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

export function messageMarker(operationId: string): string {
  if (!operation.test(operationId)) throw new ProviderMessageError("permanent");
  return `<!-- y7-feedback-operation:${operationId} -->`;
}

export function messageDocument(input: {
  readonly operationId: string;
  readonly repository: ProviderMessageRepository;
  readonly issueId: string;
  readonly content: string;
}): { readonly body: string; readonly marker: string } {
  const hasProhibitedControl = Array.from(input.content).some((character) => {
    /* v8 ignore next -- Array.from(string) only yields characters with a code point. */
    const code = character.codePointAt(0) ?? 0;
    return (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    );
  });
  if (
    !identifier.test(input.repository.id) ||
    input.repository.owner.length < 1 ||
    input.repository.owner.length > 200 ||
    input.repository.name.length < 1 ||
    input.repository.name.length > 200 ||
    !identifier.test(input.issueId) ||
    input.content.length < 1 ||
    input.content.length > 10_000 ||
    hasProhibitedControl
  )
    throw new ProviderMessageError("permanent");
  const marker = messageMarker(input.operationId);
  return { marker, body: `${input.content}\n\n${marker}` };
}

export function providerMessageFailure(status: number): "retryable" | "permanent" {
  return status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
    ? "retryable"
    : "permanent";
}

export function providerMessageInstant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new ProviderMessageError("retryable");
  return new Date(Date.parse(value)).toISOString();
}

export type ProviderMessageAdapterFactory = (
  vault: ProviderGrantVault,
) => ProviderMessageAdapter;
