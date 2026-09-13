import type { AuthoritativeProjectionHandler } from "./authoritative-projector.js";

export function createAuthoritativeProjectionRouter(input: {
  readonly feedback: AuthoritativeProjectionHandler;
  readonly conversation: AuthoritativeProjectionHandler;
}): AuthoritativeProjectionHandler {
  return {
    project: (commit) =>
      commit.aggregateKind === "feedback"
        ? input.feedback.project(commit)
        : input.conversation.project(commit),
  };
}
