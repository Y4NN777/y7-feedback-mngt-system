type DeliveryOutcome = "delivered" | "retryable" | "permanent";

export async function proveProductionSmtpEvidence(input: {
  readonly handoff: () => Promise<DeliveryOutcome>;
  readonly retry: () => Promise<DeliveryOutcome>;
  readonly terminal: () => Promise<DeliveryOutcome>;
}): Promise<{
  readonly handoff: "delivered";
  readonly retry: "retryable";
  readonly terminal: "permanent";
}> {
  const [handoff, retry, terminal] = await Promise.all([
    input.handoff(),
    input.retry(),
    input.terminal(),
  ]);
  if (handoff !== "delivered" || retry !== "retryable" || terminal !== "permanent") {
    throw new Error("PRODUCTION_SMTP_EVIDENCE_FAILED");
  }
  return { handoff, retry, terminal };
}
