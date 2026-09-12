import type {
  AttachmentAcceptanceCommand,
  AttachmentAcceptanceOutcome,
  AttachmentSaga,
} from "./attachment-saga.js";
import { pollVerification } from "./verification-poll.js";

export async function acceptAttachmentEvidence(
  saga: AttachmentSaga,
  command: AttachmentAcceptanceCommand,
  delay?: (milliseconds: number) => Promise<void>,
): Promise<AttachmentAcceptanceOutcome | undefined> {
  return pollVerification({
    attempt: () => saga.accept(command),
    accept: (outcome) => outcome.status !== "retryable",
    maximumAttempts: 3,
    intervalMs: 1_000,
    ...(delay ? { delay } : {}),
  });
}
